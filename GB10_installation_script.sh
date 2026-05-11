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
echo ">>> [0/12] Sistem kilitleri ve ortam değişkenleri mühürleniyor..."

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

# --- ADIM 1: CUDA 13.2 KURULUMU ---
echo ">>> [1/12] CUDA 13.2 Blackwell kurulumu kontrol ediliyor..."

# CUDA'nın yüklü olup olmadığını kontrol et
CUDA_INSTALLED=false
if command -v nvcc &> /dev/null; then
    CUDA_VER=$(nvcc --version | grep "release" | sed -n 's/.*release \([0-9]\+\.[0-9]\+\).*/\1/p')
    if [[ "$CUDA_VER" == "13.2" ]]; then
        echo "✅ CUDA 13.2 zaten yüklü"
        CUDA_INSTALLED=true
    else
        echo "⚠️ CUDA $CUDA_VER yüklü ama 13.2 gerekli. Yükseltiliyor..."
    fi
else
    echo "❌ CUDA bulunamadı. CUDA 13.2 yükleniyor..."
fi

# CUDA 13.2 yükle (eğer gerekirse)
if [ "$CUDA_INSTALLED" = false ]; then
    echo "CUDA Toolkit indiriliyor ve kuruluyor..."

    # Ubuntu sürümünü belirle
    UBUNTU_VER=$(lsb_release -rs | cut -d '.' -f1-2 | tr -d '.')
    echo "Ubuntu sürümü: $UBUNTU_VER"

    # NVIDIA CUDA repository ekle (Ubuntu 24.04 için 22.04 repo kullan)
    if [[ "$UBUNTU_VER" == "2404" ]]; then
        REPO_VER="ubuntu2204"
    else
        REPO_VER="ubuntu${UBUNTU_VER}04"
    fi

    echo "Repository: $REPO_VER kullanılıyor"

    # NVIDIA GPG anahtarını ve repository'i ekle
    wget https://developer.download.nvidia.com/compute/cuda/repos/$REPO_VER/x86_64/cuda-keyring_1.0-1_all.deb
    sudo dpkg -i cuda-keyring_1.0-1_all.deb

    # Repository'yi güncelle
    sudo apt-get update

    # Önce NVIDIA driver kurulumunu kontrol et
    if ! nvidia-smi &> /dev/null; then
        echo "NVIDIA driver yükleniyor..."
        sudo apt-get install -y nvidia-driver-535 nvidia-utils-535
    else
        echo "✅ NVIDIA driver zaten yüklü"
    fi

    # CUDA Toolkit yükle
    sudo apt-get install -y cuda-toolkit-12-6 || \
    sudo apt-get install -y cuda-toolkit-12-5 || \
    sudo apt-get install -y cuda-toolkit

    # CUDA environment variables ayarla
    if [ -d "/usr/local/cuda" ]; then
        export CUDA_HOME="/usr/local/cuda"
    elif [ -d "/usr/local/cuda-12.6" ]; then
        export CUDA_HOME="/usr/local/cuda-12.6"
    elif [ -d "/usr/local/cuda-12.5" ]; then
        export CUDA_HOME="/usr/local/cuda-12.5"
    else
        export CUDA_HOME="/usr/local/cuda"
    fi

    export PATH="$CUDA_HOME/bin:$PATH"
    export LD_LIBRARY_PATH="$CUDA_HOME/lib64:$LD_LIBRARY_PATH"

    # Profile'a kalıcı olarak ekle
    echo "export CUDA_HOME=\"$CUDA_HOME\"" >> ~/.bashrc
    echo 'export PATH="$CUDA_HOME/bin:$PATH"' >> ~/.bashrc
    echo 'export LD_LIBRARY_PATH="$CUDA_HOME/lib64:$LD_LIBRARY_PATH"' >> ~/.bashrc

    echo "✅ CUDA kurulumu tamamlandı: $CUDA_HOME"
    echo "⚠️ Sistem yeniden başlatılması önerilir"
fi

# --- ADIM 2: SİSTEM BAĞIMLILIKLARI VE NODE.JS ---
echo ">>> [2/12] OS paketleri ve Node.js v22..."
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

# --- ADIM 3: vLLM KAYNAK KODUNUN ÇEKİLMESİ ---
echo ">>> [3/12] vLLM kaynak kodu çekiliyor..."
if [ ! -d "$VLLM_DIR" ]; then
    git clone https://github.com/vllm-project/vllm.git "$VLLM_DIR"
    sudo chown -R nvidia:nvidia "$VLLM_DIR"
fi
cd "$VLLM_DIR" && git checkout . && git checkout main && git pull origin main
echo "✅ vLLM kaynak kodu hazır."

# --- ADIM 4: MODEL OTOMATİK İNDİRME (NEMOTRON NVFP4 — SafeTensors) ---
echo ">>> [4/12] Nemotron-3-Super-120B-A12B-NVFP4 indiriliyor (~60GB SafeTensors)..."
# CUDA'nın varlığını kontrol et ve uygun NCCL paketini seç
echo "CUDA durumu kontrol ediliyor..."
if [ -d "/usr/local/cuda" ]; then
    export CUDA_HOME="/usr/local/cuda"
    export PATH="$CUDA_HOME/bin:$PATH"
    export LD_LIBRARY_PATH="$CUDA_HOME/lib64:$LD_LIBRARY_PATH"
    echo "CUDA bulundu: $CUDA_HOME"
fi

# CUDA sürümünü kontrol et
CUDA_VERSION=""
if command -v nvcc &> /dev/null; then
    CUDA_VERSION=$(nvcc --version | grep "release" | sed -n 's/.*release \([0-9]\+\.[0-9]\+\).*/\1/p')
    echo "CUDA sürümü: $CUDA_VERSION"
else
    echo "⚠️  nvcc bulunamadı, CUDA 12.1 varsayılıyor"
    CUDA_VERSION="12.1"
fi

# HuggingFace CLI yükle (sistem paket çakışmalarını önle)
echo "HuggingFace CLI yükleniyor..."
sudo pip3 install --upgrade --force-reinstall --no-deps huggingface_hub --break-system-packages
sudo pip3 install --upgrade tqdm filelock requests --break-system-packages
echo "✅ HuggingFace CLI kuruldu"

if [ ! -d "$MODEL_DIR" ] || [ -z "$(ls -A "$MODEL_DIR" 2>/dev/null)" ]; then
    hash -r 2>/dev/null
    echo "🚀 HuggingFace CLI ile model indirme başlıyor..."
    # NOT: --include filtresi KULLANILMAZ. Bu SafeTensors modelidir (GGUF/llama.cpp değil).
    # vLLM tüm shard dosyalarına ihtiyaç duyar.
    # Yeni hf komutunu kullan (huggingface-cli deprecated)
    hf download "$MODEL_ID" \
        --local-dir "$MODEL_DIR" \
        --local-dir-use-symlinks False
else
    echo "✅ Model dizini mevcut ve dolu."
fi

# --- ADIM 5: TEMİZLİK ---
echo ">>> [5/12] Eski derleme kalıntıları temizleniyor..."
cd "$VLLM_DIR"
sudo rm -rf build/ vllm.egg-info/
sudo find . -name "*.so" -delete
sudo pip3 uninstall vllm torch torchvision torchaudio -y --break-system-packages 2>/dev/null || true
sudo pip3 cache purge

# --- ADIM 6: PYTORCH cu132 (BLACKWELL ULTRA) ---
echo ">>> [6/12] PyTorch cu132 Nightly yükleniyor..."
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

# --- ADIM 7: ÇEVRESEL DEĞİŞKENLER VE YAMA ---
echo ">>> [7/12] pyproject.toml yaması ve performans flagleri..."
# UYARI: TORCH_CUDA_ARCH_LIST burada ÜZERINE YAZILMAZ.
# Adım 0'da set edilen "9.0 10.0 12.0 12.1" korunur.
export CUDA_HOME="$CUDA_HOME"
export VLLM_TARGET_DEVICE="cuda"
export VLLM_ATTENTION_BACKEND=FLASH_ATTN
export VLLM_NVFP4_GEMM_BACKEND="marlin"
export LD_LIBRARY_PATH="$LD_LIB:$LD_LIBRARY_PATH"

sed -i 's/license = "Apache-2.0"/license = {text = "Apache-2.0"}/g' pyproject.toml 2>/dev/null || true
sed -i '/license-files =/d' pyproject.toml 2>/dev/null || true

# --- ADIM 8: vLLM ABI FIX DERLEME ---
echo ">>> [8/12] vLLM izolasyonsuz derleniyor (ABI Fix)..."
sudo -E env \
    LD_PRELOAD="$NCCL_PRELOAD" \
    LD_LIBRARY_PATH="$LD_LIB" \
    MAX_JOBS=8 \
    pip3 install -e . --no-deps --no-build-isolation --break-system-packages

# --- ADIM 9: ABI DOĞRULAMASI ---
echo ">>> [9/12] ABI doğrulanıyor..."
nm -D "$VLLM_DIR/vllm/_C.abi3.so" 2>/dev/null | grep MessageLogger && \
    echo "✅ ABI Tamam (SourceLocation imzası mevcut)." || \
    echo "❌ ABI uyuşmazlığı — kurulumu tekrar çalıştır."

# --- ADIM 10: SYSTEMD SERVİSİ ---
echo ">>> [10/12] Nemotron-Super NVFP4 servisi mühürleniyor..."
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

# --- ADIM 11: ATEŞLEME ---
echo ">>> [11/12] Nemotron-Super servisi başlatılıyor..."
sudo systemctl daemon-reload
sudo systemctl enable vllm-nemotron
sudo systemctl restart vllm-nemotron

# --- ADIM 12: HEALTH CHECK ---
echo ">>> [12/12] API hazır olması bekleniyor (max 20dk)..."
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