#!/bin/bash
# ============================================================
# ANF — Autonomous Native Forge (Industrial Setup)
# Blackwell GB10 vLLM + Nemotron-3-Super-120B-A12B-NVFP4 + Node.js
# Versiyon: 4.3.0 | Tarih: 2026-05-10
# STATUS: PRODUCTION — CUDA 13.2 / cu132 / NVFP4 / FP8 KV / Marlin
# ============================================================
set -e

echo "🚀 BLACKWELL AUTONOMOUS FORGE v4.3.0 — KURULUM BAŞLIYOR"
echo "========================================================"

# --- ADIM 0: ÖNCÜL DÜZELTMELER (KRİTİK SİSTEM YAMALARI) ---
echo ">>> [0/11] Sistem kilitleri ve ortam değişkenleri mühürleniyor..."

# 1. Externally Managed Environment & Packaging çakışma çözümü
sudo pip install --upgrade --ignore-installed packaging jsonschema --break-system-packages

# 2. Pip önbellek izin düzeltmesi
sudo chown -R nvidia:nvidia /home/nvidia/.cache 2>/dev/null || true

# 3. CUDA 13.2 ortam değişkenleri — subprocess'lere de taşınır (export zorunlu)
export CUDA_HOME="/usr/local/cuda-13.2"
export PATH="$CUDA_HOME/bin:$PATH"
export LD_LIBRARY_PATH="$CUDA_HOME/lib64:$LD_LIBRARY_PATH"

# Blackwell SM121 (GB10) + önceki arch'lar için tam liste.
# KRİTİK: Adım 6'da ÜZERINE YAZILMAMALI — bu değer derleme boyunca korunur.
export TORCH_CUDA_ARCH_LIST="9.0 10.0 12.0 12.1"

# --- SABİTLER ---
VLLM_DIR="/home/nvidia/vllm"
# NVFP4 varyantı: ~60GB VRAM, 68GB KV cache kalır. SafeTensors formatı (GGUF değil).
MODEL_ID="nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4"
MODEL_DIR="/home/nvidia/.cache/models/nemotron-super-120b-nvfp4"
PYTHON_VER="3.12"
SITE_PACKAGES="/usr/local/lib/python${PYTHON_VER}/dist-packages"
NCCL_PRELOAD="${SITE_PACKAGES}/nvidia/nccl/lib/libnccl.so.2"
LD_LIB="${SITE_PACKAGES}/torch/lib:${SITE_PACKAGES}/nvidia/nccl/lib:${CUDA_HOME}/targets/sbsa-linux/lib:${CUDA_HOME}/lib64"

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/cuda-13.2/bin:$HOME/.local/bin:$PATH"

# --- ADIM 1: SİSTEM BAĞIMLILIKLARI VE NODE.JS ---
echo ">>> [1/11] OS paketleri ve Node.js v22..."
while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
      ps aux | grep -v grep | grep -E "apt-get|dpkg" >/dev/null 2>&1; do
    echo "⏳ Paket yöneticisi meşgul, bekleniyor (5sn)..."
    sleep 5
done

sudo apt-get update -qq && \
    sudo apt-get install -y libnuma-dev curl binutils git python3-pip python3-dev build-essential

if ! node -v 2>/dev/null | grep -q "v22"; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "✅ Sistem paketleri ve Node.js hazır."

# --- ADIM 2: vLLM KAYNAK KODUNUN ÇEKİLMESİ ---
echo ">>> [2/11] vLLM kaynak kodu çekiliyor..."
if [ ! -d "$VLLM_DIR" ]; then
    git clone https://github.com/vllm-project/vllm.git "$VLLM_DIR"
    sudo chown -R nvidia:nvidia "$VLLM_DIR"
fi
cd "$VLLM_DIR" && git checkout . && git checkout main && git pull origin main
echo "✅ vLLM kaynak kodu hazır."

# --- ADIM 3: MODEL OTOMATİK İNDİRME (NEMOTRON NVFP4 — SafeTensors) ---
echo ">>> [3/11] Nemotron-3-Super-120B-A12B-NVFP4 indiriliyor (~60GB SafeTensors)..."
sudo pip3 install --upgrade "huggingface_hub[cli]" nvidia-nccl-cu132 --break-system-packages

if [ ! -d "$MODEL_DIR" ] || [ -z "$(ls -A "$MODEL_DIR" 2>/dev/null)" ]; then
    hash -r 2>/dev/null
    echo "🚀 HuggingFace CLI ile model indirme başlıyor..."
    # NOT: --include filtresi KULLANILMAZ. Bu SafeTensors modelidir (GGUF/llama.cpp değil).
    # vLLM tüm shard dosyalarına ihtiyaç duyar.
    huggingface-cli download "$MODEL_ID" \
        --local-dir "$MODEL_DIR" \
        --local-dir-use-symlinks False
else
    echo "✅ Model dizini mevcut ve dolu."
fi

# --- ADIM 4: TEMİZLİK ---
echo ">>> [4/11] Eski derleme kalıntıları temizleniyor..."
cd "$VLLM_DIR"
sudo rm -rf build/ vllm.egg-info/
sudo find . -name "*.so" -delete
sudo pip3 uninstall vllm torch torchvision torchaudio -y --break-system-packages 2>/dev/null || true
sudo pip3 cache purge

# --- ADIM 5: PYTORCH cu132 (BLACKWELL ULTRA) ---
echo ">>> [5/11] PyTorch cu132 Nightly yükleniyor..."
sudo pip3 install --pre torch torchvision torchaudio \
    --index-url https://download.pytorch.org/whl/nightly/cu132 \
    --break-system-packages

pip3 list | grep torch | awk '{print $1"==" $2}' > /tmp/torch_constraints.txt

sudo pip3 install setuptools==77.0.3 "numpy<2.3" setuptools_scm cmake ninja wheel \
    -c /tmp/torch_constraints.txt --break-system-packages

if [ -d "requirements" ]; then
    for req_file in requirements/*.txt; do
        grep -vE "torch|torchvision|torchaudio" "$req_file" > "${req_file}.tmp"
        sudo pip3 install -r "${req_file}.tmp" \
            -c /tmp/torch_constraints.txt --break-system-packages || true
    done
else
    sudo pip3 install uvloop fastapi uvicorn pydantic openai requests \
        sentencepiece "numpy<2.3" --break-system-packages
fi

echo ">>> FlashInfer (SM121 kernel yaması) derleniyor..."
sudo pip3 install git+https://github.com/flashinfer-ai/flashinfer.git \
    -c /tmp/torch_constraints.txt --break-system-packages || echo "⚠️ FlashInfer atlandı."

# --- ADIM 6: ÇEVRESEL DEĞİŞKENLER VE YAMA ---
echo ">>> [6/11] pyproject.toml yaması ve performans flagleri..."
# UYARI: TORCH_CUDA_ARCH_LIST burada ÜZERINE YAZILMAZ.
# Adım 0'da set edilen "9.0 10.0 12.0 12.1" korunur.
export CUDA_HOME="$CUDA_HOME"
export VLLM_TARGET_DEVICE="cuda"
export VLLM_ATTENTION_BACKEND=FLASH_ATTN
export VLLM_NVFP4_GEMM_BACKEND="marlin"
export LD_LIBRARY_PATH="$LD_LIB:$LD_LIBRARY_PATH"

sed -i 's/license = "Apache-2.0"/license = {text = "Apache-2.0"}/g' pyproject.toml 2>/dev/null || true
sed -i '/license-files =/d' pyproject.toml 2>/dev/null || true

# --- ADIM 7: vLLM ABI FIX DERLEME ---
echo ">>> [7/11] vLLM izolasyonsuz derleniyor (ABI Fix)..."
sudo -E env \
    LD_PRELOAD="$NCCL_PRELOAD" \
    LD_LIBRARY_PATH="$LD_LIB" \
    MAX_JOBS=8 \
    pip3 install -e . --no-deps --no-build-isolation --break-system-packages

# --- ADIM 8: ABI DOĞRULAMASI ---
echo ">>> [8/11] ABI doğrulanıyor..."
nm -D "$VLLM_DIR/vllm/_C.abi3.so" 2>/dev/null | grep MessageLogger && \
    echo "✅ ABI Tamam (SourceLocation imzası mevcut)." || \
    echo "❌ ABI uyuşmazlığı — kurulumu tekrar çalıştır."

# --- ADIM 9: SYSTEMD SERVİSİ ---
echo ">>> [9/11] Nemotron-Super NVFP4 servisi mühürleniyor..."
sudo bash -c "cat > /etc/systemd/system/vllm-nemotron.service << EOF
[Unit]
Description=vLLM Nemotron-Super-120B NVFP4 Blackwell Service
After=network.target

[Service]
Type=simple
User=nvidia
WorkingDirectory=$VLLM_DIR
Environment=\"PYTHONPATH=$VLLM_DIR\"
Environment=\"VLLM_TARGET_DEVICE=cuda\"
Environment=\"VLLM_NVFP4_GEMM_BACKEND=marlin\"
Environment=\"VLLM_ALLOW_LONG_MAX_MODEL_LEN=1\"
Environment=\"LD_PRELOAD=${NCCL_PRELOAD}\"
Environment=\"LD_LIBRARY_PATH=${LD_LIB}\"
ExecStart=/usr/bin/python3 -m vllm.entrypoints.openai.api_server \\
    --model $MODEL_DIR \\
    --served-model-name nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4 \\
    --quantization nvfp4 \\
    --kv-cache-dtype fp8 \\
    --tensor-parallel-size 1 \\
    --max-model-len 65536 \\
    --gpu-memory-utilization 0.92 \\
    --reasoning-parser nemotron_v3 \\
    --enable-auto-tool-choice \\
    --port 8000 \\
    --trust-remote-code
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF"
# Not: --enforce-eager KALDIRILDI — CUDA graph'lar GB10'da throughput'u 2-3x artırır.
# Not: VLLM_USE_V1=0 KALDIRILDI — V1 engine varsayılan ve daha hızlı; V0'a gerek yok.
# Not: --max-model-len 65536 (128K VRAM'de NVFP4 + fp8 KV ile güvenli sınır).
#      131072 denemek için VLLM_ALLOW_LONG_MAX_MODEL_LEN=1 zaten mevcut.

# --- ADIM 10: ATEŞLEME ---
echo ">>> [10/11] Nemotron-Super servisi başlatılıyor..."
sudo systemctl daemon-reload
sudo systemctl enable vllm-nemotron
sudo systemctl restart vllm-nemotron

# --- ADIM 11: HEALTH CHECK ---
echo ">>> [11/11] API hazır olması bekleniyor (max 20dk)..."
READY=0
for i in $(seq 1 120); do
    if curl -s http://localhost:8000/v1/models | \
       grep -q "NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4"; then
        echo -e "\n✅ BAŞARI: Nemotron-3-Super-120B-NVFP4 Online!"
        READY=1
        break
    fi
    echo -n "." && sleep 10
done

if [ $READY -eq 0 ]; then
    echo -e "\n❌ HATA: Servis zaman aşımına uğradı."
    echo "Log: sudo journalctl -u vllm-nemotron -f"
    exit 1
fi

echo ""
echo "=================================================="
echo "✅ ANF FABRİKA KALBİ HAZIR"
echo "   Model : Nemotron-3-Super-120B-A12B-NVFP4"
echo "   Engine: vLLM V1 | Marlin NVFP4 | FP8 KV Cache"
echo "   CUDA  : 13.2 | SM121 (Blackwell GB10)"
echo "   Port  : http://localhost:8000"
echo "=================================================="
echo ""
echo "Test:"
echo "  curl http://localhost:8000/v1/models"
echo "  curl http://localhost:8000/v1/chat/completions \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"model\":\"nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}'"
