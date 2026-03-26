#!/bin/bash
# ============================================================
# ANF — Autonomous Native Forge (Ultimate Setup)
# Blackwell GB10 vLLM + DeepSeek-R1-32B + Node.js Entegrasyonu
# Versiyon: 3.9.3 | Tarih: 2026-03-26
# STATUS: FULL VERSION - NO SHORTENING - ORIGINAL METHOD PRESERVED
# ============================================================
set -e

echo "🚀 BLACKWELL AUTONOMOUS FORGE v3.9.3 — KURULUM BAŞLIYOR"
echo "========================================================"

# --- SABİTLER (Dökümandaki Orijinal Yapı) ---
VLLM_DIR="/home/nvidia/vllm"
MODEL_DIR="/home/nvidia/.cache/models/deepseek-r1-32b"
CUDA_HOME="/usr/local/cuda-13.0"
PYTHON_VER="3.12"
SITE_PACKAGES="/usr/local/lib/python${PYTHON_VER}/dist-packages"
NCCL_PRELOAD="${SITE_PACKAGES}/nvidia/nccl/lib/libnccl.so.2"
LD_LIB="${SITE_PACKAGES}/torch/lib:${SITE_PACKAGES}/nvidia/nccl/lib:${CUDA_HOME}/targets/sbsa-linux/lib:${CUDA_HOME}/lib64"

# KRİTİK: Komutların (huggingface-cli gibi) her adımda bulunabilmesi için PATH mühürleme
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/cuda-13.0/bin:$HOME/.local/bin:$PATH"

# --- ADIM 1: SİSTEM BAĞIMLILIKLARI VE NODE.JS ---
echo ">>> [1/11] OS Paketleri ve Node.js v22..."
# Taze sistemlerde otomatik güncellemeler kilide (lock) neden olabilir, bekliyoruz.
echo "⏳ Paket kilidi kontrol ediliyor..."
while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || ps aux | grep -v grep | grep -E "apt-get|dpkg" >/dev/null 2>&1; do
    echo "⏳ Paket yöneticisi (apt/dpkg) şu an meşgul, bekliyoruz (5sn)..."
    sleep 5
done

# python3-pip ve python3-dev taze sistemlerde eksik olabilir, listeye eklendi.
sudo apt-get update -qq && sudo apt-get install -y libnuma-dev curl binutils git python3-pip python3-dev build-essential
if ! node -v | grep -q "v22" 2>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
fi
echo "✅ Sistem paketleri ve Node.js hazır."

# --- ADIM 2: vLLM KAYNAK KODUNUN ÇEKİLMESİ (MANTIK HATASI GİDERİLDİ) ---
echo ">>> [2/11] vLLM Kaynak Kodu GitHub'dan çekiliyor..."
if [ ! -d "$VLLM_DIR" ]; then
    git clone https://github.com/vllm-project/vllm.git "$VLLM_DIR"
    sudo chown -R nvidia:nvidia "$VLLM_DIR"
else
    echo "✅ vLLM dizini zaten mevcut."
fi

# --- ADIM 3: MODEL OTOMATİK İNDİRME ---
echo ">>> [3/11] DeepSeek-R1-32B ağırlıkları indiriliyor (~65GB)..."
# Orijinal gereksinimler + [cli] ek paketi (binary oluşumu için kritik)
sudo pip3 install "huggingface_hub[cli]" nvidia-nccl-cu13 --break-system-packages

if [ ! -d "$MODEL_DIR" ] || [ -z "$(ls -A "$MODEL_DIR" 2>/dev/null)" ]; then
    # Kabuk (shell) binary tablosunu tazeliyoruz (yeni kurulan komutları algılaması için)
    hash -r 2>/dev/null
    
    # Binaries bazen PATH'e hemen eklenmez. Aramayı yaparken olmayan dizinleri görmezden geliyoruz.
    # Bu sayede 'set -e' nedeniyle scriptin yarıda kesilmesini önlüyoruz.
    SEARCH_DIRS=""
    for d in /usr/local/bin /usr/bin /bin "$HOME/.local/bin"; do
        if [ -d "$d" ]; then SEARCH_DIRS="$SEARCH_DIRS $d"; fi
    done
    
    HF_CLI=$(which huggingface-cli 2>/dev/null || find $SEARCH_DIRS -name huggingface-cli -print -quit 2>/dev/null || true)
    
    if [ -n "$HF_CLI" ]; then
        echo "✅ huggingface-cli bulundu: $HF_CLI"
        "$HF_CLI" download deepseek-ai/DeepSeek-R1-Distill-Qwen-32B --local-dir "$MODEL_DIR"
    else
        # En katı ve garantili fallback: Doğrudan python kütüphanesini kullanarak indir.
        echo "🚀 huggingface-cli binary bulunamadı, Python kütüphanesi (snapshot_download) kullanılıyor..."
        python3 -c "
import os
from huggingface_hub import snapshot_download
try:
    print('>>> Model indiriliyor (bu işlem internet hızına bağlı olarak vakit alabilir)...')
    snapshot_download(
        repo_id='deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
        local_dir='$MODEL_DIR',
        local_dir_use_symlinks=False,
        resume_download=True
    )
    print('✅ İndirme tamamlandı.')
except Exception as e:
    print(f'❌ HATA: Python üzerinden indirme başarısız: {e}')
    exit(1)
"
    fi
else
    echo "✅ Model dizini mevcut ve dolu görünüyor, indirme atlanıyor."
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
echo ">>> [5/11] PyTorch cu130 Nightly ve Derleme Araçları yükleniyor..."
# cu121 aarch64'te çalışmaz, dökümandaki cu130 kararı esastır
sudo pip3 install --pre torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/nightly/cu130 \
  --break-system-packages

# vLLM source build (--no-build-isolation) için kritik derleme araçları
# setuptools_scm, cmake, ninja ve wheel eksikliği metadata generation hatasına yol açar.
sudo pip3 install setuptools_scm cmake ninja wheel --break-system-packages

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
# Orijinal başarılı formül - Tüm flaglar korunmuştur
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
# KRİTİK: VLLM_USE_V1=0 ve diğer orijinal tüm parametreler korunmuştur
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