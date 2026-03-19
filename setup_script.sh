#!/bin/bash
# ============================================================
# ANF — Autonomous Native Forge (Ultimate Setup)
# Blackwell GB10 vLLM + DeepSeek-R1-32B + Node.js Entegrasyonu
# Versiyon: 3.8 | Tarih: 2026-03-19
# Kaynak: Claude & Gemini Savaş Kayıtları (Verified Final)
# ============================================================
set -e

echo "🚀 BLACKWELL AUTONOMOUS FORGE v3.8 — KURULUM BAŞLIYOR"
echo "========================================================"

# --- SABİTLER (Dökümandaki Orijinal Yapı) ---
VLLM_DIR="/home/nvidia/vllm"
MODEL_DIR="/home/nvidia/.cache/models/deepseek-r1-32b"
CUDA_HOME="/usr/local/cuda-13.0"
PYTHON_VER="3.12"
SITE_PACKAGES="/usr/local/lib/python${PYTHON_VER}/dist-packages"
NCCL_PRELOAD="${SITE_PACKAGES}/nvidia/nccl/lib/libnccl.so.2"
LD_LIB="${SITE_PACKAGES}/torch/lib:${SITE_PACKAGES}/nvidia/nccl/lib:${CUDA_HOME}/targets/sbsa-linux/lib:${CUDA_HOME}/lib64"

# --- ADIM 1: SİSTEM BAĞIMLILIKLARI VE NODE.JS ---
echo ">>> [1/11] OS Paketleri ve Node.js v22..."
sudo apt-get update -qq && sudo apt-get install -y libnuma-dev curl nm-bin git
if ! node -v | grep -q "v22" 2>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
fi
echo "✅ Sistem paketleri ve Node.js hazır."

# --- ADIM 2: vLLM KAYNAK KODUNUN ÇEKİLMESİ (MANTIK HATASI GİDERİLDİ) ---
echo ">>> [2/11] vLLM Kaynak Kodu GitHub'dan çekiliyor..."
if [ ! -d "$VLLM_DIR" ]; then
    git clone https://github.com/vllm-project/vllm.git "$VLLM_DIR"
else
    echo "✅ vLLM dizini zaten mevcut."
fi

# --- ADIM 3: MODEL OTOMATİK İNDİRME ---
echo ">>> [3/11] DeepSeek-R1-32B ağırlıkları indiriliyor (~65GB)..."
if [ ! -d "$MODEL_DIR" ]; then
    sudo pip3 install huggingface_hub --break-system-packages
    huggingface-cli download deepseek-ai/DeepSeek-R1-Distill-Qwen-32B --local-dir "$MODEL_DIR"
fi
echo "✅ Model dosyaları hazır."

# --- ADIM 4: TEMİZLİK (FRESH BUILD İÇİN) ---
echo ">>> [4/11] Eski derleme kalıntıları temizleniyor..."
cd "$VLLM_DIR"
sudo rm -rf build/ vllm.egg-info/
sudo find . -name "*.so" -delete
sudo pip3 uninstall vllm torch torchvision torchaudio -y --break-system-packages 2>/dev/null || true
sudo pip3 cache purge # Yetki sorunu için sudo eklendi

# --- ADIM 5: PYTORCH CU130 (BLACKWELL AARCH64 ÖZEL) ---
echo ">>> [5/11] PyTorch cu130 Nightly yükleniyor..."
# cu121 aarch64'te çalışmaz, dökümandaki cu130 kararı esastır
sudo pip3 install --pre torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/nightly/cu130 \
  --break-system-packages

# --- ADIM 6: ÇEVRESEL DEĞİŞKENLER VE METADATA YAMASI ---
echo ">>> [6/11] Değişkenler mühürleniyor ve pyproject.toml yamalanıyor..."
export CUDA_HOME="$CUDA_HOME"
export TORCH_CUDA_ARCH_LIST="12.1"
export VLLM_TARGET_DEVICE="cuda"
export LD_LIBRARY_PATH="$LD_LIB:$LD_LIBRARY_PATH"
export PATH="$CUDA_HOME/bin:$PATH"

# Metadata hatasını (license-files) önleyen yama
sed -i 's/license = "Apache-2.0"/license = {text = "Apache-2.0"}/g' pyproject.toml 2>/dev/null || true
sed -i '/license-files =/d' pyproject.toml 2>/dev/null || true

# --- ADIM 7: vLLM ABI FIX DERLEME (KRİTİK ADIM) ---
echo ">>> [7/11] vLLM izolasyonsuz derleniyor (ABI Fix)..."
# Gemini dökümanındaki tam başarı formülü
sudo -E env \
  LD_PRELOAD="$NCCL_PRELOAD" \
  LD_LIBRARY_PATH="$LD_LIB" \
  TORCH_CUDA_ARCH_LIST="12.1" \
  VLLM_TARGET_DEVICE="cuda" \
  MAX_JOBS=8 \
  pip3 install -e . --no-deps --no-build-isolation --break-system-packages

# --- ADIM 8: ABI DOĞRULAMA (SANITY CHECK) ---
echo ">>> [8/11] ABI Doğrulanıyor (nm kontrolü)..."
nm -D "$VLLM_DIR/vllm/_C.abi3.so" 2>/dev/null | grep MessageLogger && echo "✅ ABI Doğrulandı: SourceLocation imzası mevcut."

# --- ADIM 9: SYSTEMD SERVİSİ (STABİLİTE & V0 MOTORU) ---
echo ">>> [9/11] Servis dosyası mühürleniyor..."
# KRİTİK: VLLM_USE_V1=0 ile donma sorunu engellendi
sudo bash -c "cat > /etc/systemd/system/vllm-deepseek.service << EOF
[Unit]
Description=vLLM DeepSeek-R1 Blackwell Service
After=network.target

[Service]
Type=simple
User=nvidia
WorkingDirectory=$VLLM_DIR
Environment=\"PYTHONPATH=$VLLM_DIR\"
Environment=\"VLLM_USE_V1=0\"
Environment=\"VLLM_TARGET_DEVICE=cuda\"
Environment=\"LD_PRELOAD=${NCCL_PRELOAD}\"
Environment=\"LD_LIBRARY_PATH=${LD_LIB}\"
ExecStart=/usr/bin/python3 -m vllm.entrypoints.openai.api_server \\
    --model $MODEL_DIR \\
    --served-model-name deepseek-r1-32b \\
    --tensor-parallel-size 1 \\
    --max-model-len 32768 \\
    --dtype bfloat16 \\
    --port 8000 \\
    --trust-remote-code \\
    --gpu-memory-utilization 0.90 \\
    --enforce-eager
Restart=always

[Install]
WantedBy=multi-user.target
EOF"

# --- ADIM 10: SERVİSİ ATEŞLEME ---
echo ">>> [10/11] Servis başlatılıyor..."
sudo systemctl daemon-reload && sudo systemctl restart vllm-deepseek

# --- ADIM 11: HEALTH CHECK (10 DK TIMEOUT) ---
echo ">>> [11/11] vLLM API Hazır Olması Bekleniyor..."
READY=0
for i in $(seq 1 60); do
  if curl -s http://localhost:8000/v1/models | grep -q "deepseek-r1-32b"; then
    echo -e "\n✅ BAŞARI: DeepSeek-R1-32B şu an Online!"
    READY=1
    break
  fi
  echo -n "." && sleep 10
done

if [ $READY -eq 0 ]; then
    echo -e "\n❌ ZAMAN AŞIMI: Servis 10 dakikada yanıt vermedi."
    echo "Hata kontrolü: sudo journalctl -u vllm-deepseek -f"
    exit 1
fi

echo "=================================================="
echo "✅ ANF KURULUM VE STABİLİTE DOĞRULAMASI TAMAMLANDI"
echo "=================================================="