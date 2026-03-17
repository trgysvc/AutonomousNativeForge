# Blackwell GB10 — vLLM & DeepSeek-R1 Setup Protocol v2.0

> **Bu döküman v1.0'ın sahada test edilmiş revizyonudur.**
> v1.0'dan farklılaşan her adım `⚠️ V1 FARKI` etiketi ile işaretlenmiştir.
> Bu protokol doğrulanmıştır.

**Hardware:** NVIDIA Blackwell GB10 | 120GB VRAM | aarch64 (sbsa-linux)  
**Model:** DeepSeek-R1-Distill-Qwen-32B (bfloat16)  
**Inference Engine:** vLLM v0.7.1 (pip install, --no-build-isolation)  
**OS:** Linux aarch64 | Python 3.12 | CUDA 13.0  
**Last Verified:** 2026-03-16

---

## Table of Contents

1. [Otomasyon — Tek Komutla Kurulum](#1-otomasyon--tek-komutla-kurulum)
2. [Manuel Kurulum — Adım Adım](#2-manuel-kurulum--adım-adım)
3. [Servis Başlatma](#3-servis-başlatma)
4. [Doğrulama](#4-doğrulama)
5. [Failure Index — v2 Yeni Hatalar](#5-failure-index--v2-yeni-hatalar)
6. [v1.0 ile Fark Tablosu](#6-v10-ile-fark-tablosu)

---

## 1. Otomasyon — Tek Komutla Kurulum

Sistem her resetlendiğinde aşağıdaki script tüm kurulumu otomatik gerçekleştirir:

```bash
chmod +x /home/nvidia/vllm/setup_blackwell.sh
/home/nvidia/vllm/setup_blackwell.sh
```

Script içeriği (`/home/nvidia/vllm/setup_blackwell.sh`):

```bash
#!/bin/bash
set -e
echo ">>> [1/7] OS bağımlılıkları..."
sudo apt-get update -qq && sudo apt-get install -y libnuma-dev

echo ">>> [2/7] Eski kalıntılar temizleniyor..."
cd /home/nvidia/vllm
sudo rm -rf build/ vllm.egg-info/
sudo find . -name "*.so" -delete
sudo pip3 uninstall vllm torch torchvision torchaudio -y \
  --break-system-packages 2>/dev/null || true
pip3 cache purge

echo ">>> [3/7] PyTorch cu130 (Blackwell aarch64) yükleniyor..."
sudo pip3 install --pre torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/nightly/cu130 \
  --break-system-packages

echo ">>> [4/7] Çevresel değişkenler mühürleniyor..."
export CUDA_HOME=/usr/local/cuda-13.0
export TORCH_CUDA_ARCH_LIST="12.1"
export VLLM_TARGET_DEVICE="cuda"
export SITE_PACKAGES=/usr/local/lib/python3.12/dist-packages

echo ">>> [5/7] vLLM izolasyonsuz derleniyor (~10-15 dk)..."
sudo -E env \
  LD_PRELOAD="$SITE_PACKAGES/nvidia/nccl/lib/libnccl.so.2" \
  LD_LIBRARY_PATH="$SITE_PACKAGES/torch/lib:$SITE_PACKAGES/nvidia/nccl/lib:$CUDA_HOME/targets/sbsa-linux/lib:$CUDA_HOME/lib64" \
  MAX_JOBS=8 \
  pip3 install -e . --no-deps --no-build-isolation --break-system-packages

echo ">>> [6/7] Systemd servisi oluşturuluyor..."
sudo bash -c 'cat > /etc/systemd/system/vllm-deepseek.service << '"'"'EOF'"'"'
[Unit]
Description=vLLM DeepSeek-R1 Blackwell Service
After=network.target

[Service]
Type=simple
User=nvidia
WorkingDirectory=/home/nvidia/vllm
Environment="PYTHONPATH=/home/nvidia/vllm"
Environment="VLLM_USE_V1=0"
Environment="LD_PRELOAD=/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib/libnccl.so.2"
Environment="LD_LIBRARY_PATH=/usr/local/lib/python3.12/dist-packages/torch/lib:/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib:/usr/local/cuda-13.0/targets/sbsa-linux/lib:/usr/local/cuda-13.0/lib64"
ExecStart=/usr/bin/python3 -m vllm.entrypoints.openai.api_server \
  --model /home/nvidia/.cache/models/deepseek-r1-32b \
  --served-model-name deepseek-r1-32b \
  --tensor-parallel-size 1 \
  --max-model-len 32768 \
  --dtype bfloat16 \
  --port 8000 \
  --trust-remote-code \
  --gpu-memory-utilization 0.90 \
  --enforce-eager
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF'

echo ">>> [7/7] Servis başlatılıyor..."
sudo systemctl daemon-reload
sudo systemctl enable vllm-deepseek
sudo systemctl start vllm-deepseek

echo ""
echo "✅ KURULUM TAMAMLANDI."
echo "Servis durumu: sudo systemctl status vllm-deepseek"
echo "Canlı log: sudo journalctl -u vllm-deepseek -f"
echo "Test: curl http://localhost:8000/v1/models"
```

---

## 2. Manuel Kurulum — Adım Adım

### 2.1. OS Bağımlılıkları

⚠️ **V1 FARKI:** `libnuma-dev` v1.0'da yoktu. Olmadan vLLM CPU extension derlemesi `numa.h: No such file or directory` hatasıyla çöker.

```bash
sudo apt-get update && sudo apt-get install -y libnuma-dev
```

### 2.2. Çevresel Değişkenler

v1.0 ile aynı — değişmedi:

```bash
export CUDA_HOME=/usr/local/cuda-13.0
export LD_LIBRARY_PATH=$CUDA_HOME/targets/sbsa-linux/lib:$CUDA_HOME/lib64:/usr/lib/aarch64-linux-gnu:$LD_LIBRARY_PATH
export PATH=$CUDA_HOME/bin:$PATH
```

Kalıcı hale getirmek için `~/.bashrc`'ye ekle.

### 2.3. Temizlik

Günlük reset sonrası veya yeniden kurulum öncesi zorunludur:

```bash
cd /home/nvidia/vllm
sudo rm -rf build/ vllm.egg-info/
sudo find . -name "*.so" -delete
sudo pip3 uninstall vllm torch torchvision torchaudio -y --break-system-packages
pip3 cache purge
```

### 2.4. PyTorch Kurulumu

⚠️ **V1 FARKI — KRİTİK:** v1.0'da `cu121` index kullanılıyordu. aarch64 için cu121 binary'si **mevcut değildir**. Doğru index `cu130`'dur.

```bash
# ❌ v1.0 — aarch64'te çalışmaz
# pip3 install --pre torch ... --index-url .../cu121

# ✅ v2.0 — Blackwell aarch64 için doğru index
sudo pip3 install --pre torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/nightly/cu130 \
  --break-system-packages
```

Doğrulama — GPU görünür olmalı:

```bash
export LD_PRELOAD=/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib/libnccl.so.2
python3 -c "import torch; print(torch.cuda.is_available()); print(torch.__version__)"
# True
# 2.12.0.dev+cu130
```

### 2.5. vLLM Kurulumu

⚠️ **V1 FARKI — KRİTİK:** v1.0'da `python3 setup.py build_ext --inplace` + `pip3 install -e .` kullanılıyordu. Bu yaklaşım pip'in build isolation özelliği nedeniyle **ABI mismatch** üretir (bkz. FAIL-011). v2.0'da tek adımda `--no-build-isolation` ile kurulum yapılır.

```bash
export CUDA_HOME=/usr/local/cuda-13.0
export TORCH_CUDA_ARCH_LIST="12.1"
export VLLM_TARGET_DEVICE="cuda"
export SITE_PACKAGES=/usr/local/lib/python3.12/dist-packages

# pyproject.toml yaması (v1.0'dan aynı, hala gerekli)
sed -i 's/license = "Apache-2.0"/license = {text = "Apache-2.0"}/g' pyproject.toml
sed -i '/license-files =/d' pyproject.toml

# Kritik: sudo -E env ile LD_PRELOAD'ı subprocess'e enjekte et
sudo -E env \
  LD_PRELOAD="$SITE_PACKAGES/nvidia/nccl/lib/libnccl.so.2" \
  LD_LIBRARY_PATH="$SITE_PACKAGES/torch/lib:$SITE_PACKAGES/nvidia/nccl/lib:$CUDA_HOME/targets/sbsa-linux/lib:$CUDA_HOME/lib64" \
  MAX_JOBS=8 \
  pip3 install -e . --no-deps --no-build-isolation --break-system-packages
```

Neden `--no-build-isolation`? pip varsayılan olarak izole bir build ortamı oluşturur ve bu ortama `pyproject.toml`'daki kısıtlamalar doğrultusunda farklı (eski) bir torch sürümü indirir. vLLM bu eski sürümün header dosyalarına göre derlenir. Çalışma anında ise sistemdeki yeni cu130 torch bulunur ve sembol imzaları uyuşmaz. `--no-build-isolation` bunu engeller: derleme sistemdeki mevcut torch'u görür ve ona göre mühürlenir.

ABI doğrulaması — kurulum sonrası çalıştır:

```bash
nm -D vllm/_C.abi3.so | grep MessageLogger
# SourceLocation ifadesini içermeli (yeni imza)
# EPKciib içeriyorsa ABI mismatch var — kurulumu tekrarla
```

### 2.6. Model İndirme

v1.0 ile aynı:

```bash
huggingface-cli download deepseek-ai/DeepSeek-R1-Distill-Qwen-32B \
  --local-dir /home/nvidia/.cache/models/deepseek-r1-32b
```

---

## 3. Servis Başlatma

### 3.1. Systemd Servisi (Önerilen)

⚠️ **V1 FARKI:** `--served-model-name deepseek-r1-32b` eklendi. Bu parametre olmadan ajanlar `404 Not Found` alır çünkü model dosya yoluyla değil ismiyle sorgulanır.

`/etc/systemd/system/vllm-deepseek.service`:

```ini
[Unit]
Description=vLLM DeepSeek-R1 Blackwell Service
After=network.target

[Service]
Type=simple
User=nvidia
WorkingDirectory=/home/nvidia/vllm
Environment="PYTHONPATH=/home/nvidia/vllm"
Environment="VLLM_USE_V1=0"
Environment="LD_PRELOAD=/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib/libnccl.so.2"
Environment="LD_LIBRARY_PATH=/usr/local/lib/python3.12/dist-packages/torch/lib:/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib:/usr/local/cuda-13.0/targets/sbsa-linux/lib:/usr/local/cuda-13.0/lib64"
ExecStart=/usr/bin/python3 -m vllm.entrypoints.openai.api_server \
    --model /home/nvidia/.cache/models/deepseek-r1-32b \
    --served-model-name deepseek-r1-32b \
    --tensor-parallel-size 1 \
    --max-model-len 32768 \
    --dtype bfloat16 \
    --port 8000 \
    --trust-remote-code \
    --gpu-memory-utilization 0.90 \
    --enforce-eager
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable vllm-deepseek
sudo systemctl start vllm-deepseek
```

### 3.2. Manuel Başlatma (Test)

```bash
export VLLM_USE_V1=0
export LD_PRELOAD=/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib/libnccl.so.2
export LD_LIBRARY_PATH=/usr/local/lib/python3.12/dist-packages/torch/lib:/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib:/usr/local/cuda-13.0/targets/sbsa-linux/lib:/usr/local/cuda-13.0/lib64:$LD_LIBRARY_PATH

CUDA_LAUNCH_BLOCKING=1 python3 -m vllm.entrypoints.openai.api_server \
  --model "/home/nvidia/.cache/models/deepseek-r1-32b" \
  --served-model-name deepseek-r1-32b \
  --tensor-parallel-size 1 \
  --max-model-len 32768 \
  --dtype bfloat16 \
  --port 8000 \
  --trust-remote-code \
  --gpu-memory-utilization 0.90 \
  --enforce-eager
```

**Beklenen çıktı:** `Application startup complete`

---

## 4. Doğrulama

```bash
# Model alias çalışıyor mu?
curl http://localhost:8000/v1/models
# Beklenen: "id": "deepseek-r1-32b"

# İlk inference testi
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-r1-32b",
    "messages": [{"role": "user", "content": "Write a Node.js function that reads a file natively."}],
    "max_tokens": 500
  }'
```

---

## 5. Failure Index — v2 Yeni Hatalar

Bu hatalar v1.0'da belgelenmemişti. v2 kurulum sürecinde keşfedildi.

---

### FAIL-008 — cu121 wheel not found on aarch64
**Semptom:** `ERROR: Could not find a version that satisfies the requirement torch`  
**Neden:** cu121 index'inde aarch64 binary'si yok. v1.0 x86_64 için yazılmıştı.  
**Çözüm:** `cu130` index kullan.

---

### FAIL-009 — ncclWaitSignal undefined symbol
**Semptom:** `ImportError: libtorch_cuda.so: undefined symbol: ncclWaitSignal`  
**Neden:** Sistem NCCL kütüphanesi (apt) ncclWaitSignal sembolünü içermiyor. pip ile kurulan `nvidia-nccl-cu13` linker tarafından görülmüyor.  
**Çözüm:**
```bash
export LD_PRELOAD=/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib/libnccl.so.2
```
Bu export'u tüm Python çağrılarından önce yapılmalı. Systemd servisinde `Environment=` satırı olarak mühürlü.

---

### FAIL-010 — numa.h not found
**Semptom:** `fatal error: numa.h: No such file or directory` (vLLM CPU extension)  
**Neden:** `libnuma-dev` kurulu değil.  
**Çözüm:**
```bash
sudo apt-get install -y libnuma-dev
```

---

### FAIL-011 — ABI Mismatch: MessageLogger undefined symbol
**Semptom:** `ImportError: vllm/_C.abi3.so: undefined symbol: _ZN3c1013MessageLoggerC1EPKciib`  
**Neden (nm ile doğrulandı):**

```
# vLLM binarisi arıyor (eski imza):
U _ZN3c1013MessageLoggerC1EPKciib        ← (const char*, int, int, bool)

# Torch kütüphanesi sunuyor (yeni imza):
T _ZN3c1013MessageLoggerC1ENS_14SourceLocationEib  ← (SourceLocation, int, bool)
```

pip'in build isolation özelliği, derleme anında `pyproject.toml`'daki sürüm kısıtlamasına uyan daha eski bir torch indirerek header dosyalarını oradan kullanır. Derlenen binary bu eski imzayı bekler ama runtime'da yeni cu130 torch bulur.

**Çözüm:** `--no-build-isolation` + `sudo -E env` ile LD_PRELOAD enjeksiyonu:
```bash
sudo -E env LD_PRELOAD="..." pip3 install -e . --no-deps --no-build-isolation --break-system-packages
```

`sudo -E` tek başına yeterli değildir — pip'in subprocess zinciri değişkenleri taşımaz. `sudo -E env VAR=value pip3` şeklinde açıkça enjekte edilmesi zorunludur.

---

### FAIL-012 — Agent 404: Model Not Found
**Semptom:** ANF ajanları vLLM'e istek gönderir ama `404 Not Found` alır.  
**Neden:** vLLM modeli dosya yoluyla serve eder (`/home/nvidia/.cache/...`), ajanlar `deepseek-r1-32b` ismiyle sorgular.  
**Çözüm:** `--served-model-name deepseek-r1-32b` parametresi eklendi.

---

## 6. v1.0 ile Fark Tablosu

| Parametre / Adım | v1.0 | v2.0 | Neden Değişti |
|---|---|---|---|
| PyTorch index | `cu121` | `cu130` | cu121 aarch64 binary'si yok |
| libnuma-dev | Yok | Zorunlu | vLLM CPU extension gerektirir |
| Build yöntemi | `setup.py build_ext + pip install` | `pip install --no-build-isolation` | ABI mismatch önleme |
| LD_PRELOAD | Sadece runtime | Hem build hem runtime | ncclWaitSignal subprocess'e geçmeli |
| `--served-model-name` | Yok | `deepseek-r1-32b` | Agent 404 önleme |
| `--gpu-memory-utilization` | `0.85` | `0.90` | Systemd Gnome/Xorg baskısını kaldırır |
| Deployment | Manuel terminal | systemd servisi | Günlük reset sonrası otomatik başlatma |

---

*Bu döküman sahada kazanılan deneyimleri yansıtır. Her değişikliğin gerekçesi kayıt altındadır.*
