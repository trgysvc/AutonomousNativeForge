#!/bin/bash
# ==============================================================================
# ANF — Autonomous Native Forge (Blackwell GB10 Optimized)
# Versiyon: 2.3 | Tarih: 2026-03-19
# Destek: vLLM + DeepSeek-R1-32B + CUDA 13.0 + aarch64
# ==============================================================================
set -e

# --- RENKLER ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 BLACKWELL NATIVE FORGE v2.3 BAŞLATILIYOR...${NC}"
echo "=================================================="

# --- SABİTLER ---
VLLM_DIR="/home/nvidia/vllm"
MODEL_DIR="/home/nvidia/.cache/models/deepseek-r1-32b"
CUDA_HOME="/usr/local/cuda-13.0"
SITE_PACKAGES="/usr/local/lib/python3.12/dist-packages"
NCCL_PRELOAD="$SITE_PACKAGES/nvidia/nccl/lib/libnccl.so.2"
LD_LIB="$SITE_PACKAGES/torch/lib:$SITE_PACKAGES/nvidia/nccl/lib:$CUDA_HOME/targets/sbsa-linux/lib:$CUDA_HOME/lib64"

# --- ADIM 1: NODE.JS V22 KONTROLÜ ---
echo -e "${YELLOW}>>> [1/9] Çevresel Bağımlılıklar (Node.js v22)...${NC}"
if ! node -v | grep -q "v22" 2>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "✅ Node.js $(node -v) hazır."
fi

# --- ADIM 2: SİSTEM BAĞIMLILIKLARI ---
echo -e "${YELLOW}>>> [2/9] OS Paketleri (libnuma-dev)...${NC}"
sudo apt-get update -qq && sudo apt-get install -y libnuma-dev curl nm-bin
echo "✅ Sistem paketleri hazır."

# --- ADIM 3: MODEL OTOMASYONU ---
echo -e "${YELLOW}>>> [3/9] Model Dosyaları Doğrulanıyor...${NC}"
if [ ! -d "$MODEL_DIR" ]; then
    echo "⚠️  Model bulunamadı. İndiriliyor (~65GB)..."
    sudo pip3 install huggingface_hub --break-system-packages
    huggingface-cli download deepseek-ai/DeepSeek-R1-Distill-Qwen-32B --local-dir "$MODEL_DIR"
else
    echo "✅ Model dizini mevcut."
fi

# --- ADIM 4: TEMİZLİK (FRESH START) ---
echo -e "${YELLOW}>>> [4/9] Eski Kalıntılar Temizleniyor...${NC}"
cd "$VLLM_DIR" || { echo -e "${RED}Hata: $VLLM_DIR bulunamadı!${NC}"; exit 1; }
sudo rm -rf build/ vllm.egg-info/
sudo find . -name "*.so" -delete
sudo pip3 uninstall vllm torch torchvision torchaudio -y --break-system-packages 2>/dev/null || true
pip3 cache purge

# --- ADIM 5: PYTORCH CU130 (BLACKWELL ÖZEL) ---
echo -e "${YELLOW}>>> [5/9] PyTorch cu130 (aarch64) Nightly Yükleniyor...${NC}"
# Blackwell için cu121 yetersizdir, mutlaka cu130 nightly kullanılmalıdır
sudo pip3 install --pre torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/nightly/cu130 \
  --break-system-packages

# --- ADIM 6: vLLM ABI FIX DERLEME ---
echo -e "${YELLOW}>>> [6/9] vLLM İzolasyonsuz Derleniyor (Kritik Adım)...${NC}"
# pyproject.toml yaması (Metadata hatası önleyici)
sed -i 's/license = "Apache-2.0"/license = {text = "Apache-2.0"}/g' pyproject.toml 2>/dev/null || true

# Gemini Fix: sudo -E env ve --no-build-isolation kullanımı ABI mismatch'i engeller
sudo -E env \
  LD_PRELOAD="$NCCL_PRELOAD" \
  LD_LIBRARY_PATH="$LD_LIB" \
  TORCH_CUDA_ARCH_LIST="12.1" \
  VLLM_TARGET_DEVICE="cuda" \
  MAX_JOBS=8 \
  pip3 install -e . --no-deps --no-build-isolation --break-system-packages
echo "✅ vLLM derlendi."

# --- ADIM 7: SYSTEMD SERVİSİ (GENİŞLETİLMİŞ) ---
echo -e "${YELLOW}>>> [7/9] Systemd Servisi Mühürleniyor...${NC}"
# Tırnaksız EOF ile değişkenlerin (LD_PRELOAD vb.) servis dosyasına akması sağlandı
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
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF"

# --- ADIM 8: SERVİSİ BAŞLAT ---
echo -e "${YELLOW}>>> [8/9] Servis Motoru Ateşleniyor...${NC}"
sudo systemctl daemon-reload
sudo systemctl enable vllm-deepseek
sudo systemctl start vllm-deepseek

# --- ADIM 9: HEALTH CHECK (WAIT FOR LLM) ---
echo -e "${YELLOW}>>> [9/9] vLLM API Bekleniyor (Tahmini 3-5 dk)...${NC}"
READY=0
for i in $(seq 1 40); do
  if curl -s http://localhost:8000/v1/models | grep -q "deepseek-r1-32b"; then
    echo -e "\n${GREEN}✅ SİSTEM ONLINE! DeepSeek-R1-32B servis veriyor.${NC}"
    READY=1
    break
  fi
  echo -n "."
  sleep 10
done

if [ $READY -eq 0 ]; then
  echo -e "\n${RED}❌ HATA: Servis hazır değil. 'sudo journalctl -u vllm-deepseek -f' ile kontrol edin.${NC}"
  exit 1
fi

echo "=================================================="
echo -e "${GREEN}✅ KURULUM BAŞARIYLA TAMAMLANDI${NC}"
echo "API Endpoint: http://localhost:8000/v1/chat/completions"
echo "=================================================="