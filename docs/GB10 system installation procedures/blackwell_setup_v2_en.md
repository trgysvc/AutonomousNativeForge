# Blackwell GB10 — vLLM & DeepSeek-R1 Setup Protocol v2.0

> **This document is the field-tested revision of v1.0.**
> Every step that differs from v1.0 is marked with `⚠️ V1 DIFF`.
> This protocol has been verified as reproducible after daily 02:00 system resets.

**Hardware:** NVIDIA Blackwell GB10 | 120GB VRAM | aarch64 (sbsa-linux)  
**Model:** DeepSeek-R1-Distill-Qwen-32B (bfloat16)  
**Inference Engine:** vLLM v0.7.1 (pip install, --no-build-isolation)  
**OS:** Linux aarch64 | Python 3.12 | CUDA 13.0  
**Last Verified:** 2026-03-16

---

## Table of Contents

1. [Automation — One Command Setup](#1-automation--one-command-setup)
2. [Manual Setup — Step by Step](#2-manual-setup--step-by-step)
3. [Launching the Service](#3-launching-the-service)
4. [Verification](#4-verification)
5. [Failure Index — v2 New Failures](#5-failure-index--v2-new-failures)
6. [Diff Table — v1.0 vs v2.0](#6-diff-table--v10-vs-v20)

---

## 1. Automation — One Command Setup

After each system reset, the following script handles the entire installation automatically:

```bash
chmod +x /home/nvidia/vllm/setup_blackwell.sh
/home/nvidia/vllm/setup_blackwell.sh
```

Script contents (`/home/nvidia/vllm/setup_blackwell.sh`):

```bash
#!/bin/bash
set -e
echo ">>> [1/7] OS dependencies..."
sudo apt-get update -qq && sudo apt-get install -y libnuma-dev

echo ">>> [2/7] Cleaning old artifacts..."
cd /home/nvidia/vllm
sudo rm -rf build/ vllm.egg-info/
sudo find . -name "*.so" -delete
sudo pip3 uninstall vllm torch torchvision torchaudio -y \
  --break-system-packages 2>/dev/null || true
pip3 cache purge

echo ">>> [3/7] Installing PyTorch cu130 (Blackwell aarch64)..."
sudo pip3 install --pre torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/nightly/cu130 \
  --break-system-packages

echo ">>> [4/7] Sealing environment variables..."
export CUDA_HOME=/usr/local/cuda-13.0
export TORCH_CUDA_ARCH_LIST="12.1"
export VLLM_TARGET_DEVICE="cuda"
export SITE_PACKAGES=/usr/local/lib/python3.12/dist-packages

echo ">>> [5/7] pyproject.toml patch + building vLLM without isolation (~10-15 min)..."
sed -i 's/license = "Apache-2.0"/license = {text = "Apache-2.0"}/g' pyproject.toml
sed -i '/license-files =/d' pyproject.toml
sudo -E env \
  LD_PRELOAD="$SITE_PACKAGES/nvidia/nccl/lib/libnccl.so.2" \
  LD_LIBRARY_PATH="$SITE_PACKAGES/torch/lib:$SITE_PACKAGES/nvidia/nccl/lib:$CUDA_HOME/targets/sbsa-linux/lib:$CUDA_HOME/lib64" \
  MAX_JOBS=8 \
  pip3 install -e . --no-deps --no-build-isolation --break-system-packages

echo ">>> [6/7] Creating systemd service..."
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

echo ">>> [7/7] Starting service..."
sudo systemctl daemon-reload
sudo systemctl enable vllm-deepseek
sudo systemctl start vllm-deepseek

echo ""
echo "✅ SETUP COMPLETE."
echo "Service status: sudo systemctl status vllm-deepseek"
echo "Live logs:      sudo journalctl -u vllm-deepseek -f"
echo "Test:           curl http://localhost:8000/v1/models"
```

---

## 2. Manual Setup — Step by Step

### 2.1. OS Dependencies

⚠️ **V1 DIFF:** `libnuma-dev` was absent in v1.0. Without it, the vLLM CPU extension build fails with `numa.h: No such file or directory`.

```bash
sudo apt-get update && sudo apt-get install -y libnuma-dev
```

### 2.2. Environment Variables

Same as v1.0 — unchanged:

```bash
export CUDA_HOME=/usr/local/cuda-13.0
export LD_LIBRARY_PATH=$CUDA_HOME/targets/sbsa-linux/lib:$CUDA_HOME/lib64:/usr/lib/aarch64-linux-gnu:$LD_LIBRARY_PATH
export PATH=$CUDA_HOME/bin:$PATH
```

Add to `~/.bashrc` for persistence.

### 2.3. Clean Slate

Required before every rebuild or after a system reset:

```bash
cd /home/nvidia/vllm
sudo rm -rf build/ vllm.egg-info/
sudo find . -name "*.so" -delete
sudo pip3 uninstall vllm torch torchvision torchaudio -y --break-system-packages
pip3 cache purge
```

### 2.4. PyTorch Installation

⚠️ **V1 DIFF — CRITICAL:** v1.0 used the `cu121` index. No cu121 binary exists for aarch64. The correct index for Blackwell aarch64 is `cu130`.

```bash
# ❌ v1.0 — does not work on aarch64
# pip3 install --pre torch ... --index-url .../cu121

# ✅ v2.0 — correct index for Blackwell aarch64
sudo pip3 install --pre torch torchvision torchaudio \
  --index-url https://download.pytorch.org/whl/nightly/cu130 \
  --break-system-packages
```

Verification — GPU must be visible:

```bash
export LD_PRELOAD=/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib/libnccl.so.2
python3 -c "import torch; print(torch.cuda.is_available()); print(torch.__version__)"
# True
# 2.12.0.dev+cu130
```

### 2.5. vLLM Installation

⚠️ **V1 DIFF — CRITICAL:** v1.0 used `python3 setup.py build_ext --inplace` + `pip3 install -e .`. This approach causes an **ABI mismatch** due to pip's build isolation (see FAIL-011). v2.0 installs in a single step using `--no-build-isolation`.

```bash
export CUDA_HOME=/usr/local/cuda-13.0
export TORCH_CUDA_ARCH_LIST="12.1"
export VLLM_TARGET_DEVICE="cuda"
export SITE_PACKAGES=/usr/local/lib/python3.12/dist-packages

# pyproject.toml patch (same as v1.0 — still required)
sed -i 's/license = "Apache-2.0"/license = {text = "Apache-2.0"}/g' pyproject.toml
sed -i '/license-files =/d' pyproject.toml

# Critical: inject LD_PRELOAD into subprocess via sudo -E env
sudo -E env \
  LD_PRELOAD="$SITE_PACKAGES/nvidia/nccl/lib/libnccl.so.2" \
  LD_LIBRARY_PATH="$SITE_PACKAGES/torch/lib:$SITE_PACKAGES/nvidia/nccl/lib:$CUDA_HOME/targets/sbsa-linux/lib:$CUDA_HOME/lib64" \
  MAX_JOBS=8 \
  pip3 install -e . --no-deps --no-build-isolation --break-system-packages
```

**Why `--no-build-isolation`?** By default, pip creates an isolated build environment and downloads a separate (older) torch version based on `pyproject.toml` constraints. vLLM compiles against that older torch's headers. At runtime, the system's newer cu130 torch is found instead — and the symbol signatures don't match. `--no-build-isolation` prevents this: the build sees the installed cu130 torch and seals the binary against it.

ABI verification — run after installation:

```bash
nm -D vllm/_C.abi3.so | grep MessageLogger
# Must contain "SourceLocation" (new signature)
# If it contains "EPKciib" — ABI mismatch persists, reinstall
```

### 2.6. Model Download

Same as v1.0:

```bash
huggingface-cli download deepseek-ai/DeepSeek-R1-Distill-Qwen-32B \
  --local-dir /home/nvidia/.cache/models/deepseek-r1-32b
```

---

## 3. Launching the Service

### 3.1. systemd Service (Recommended)

⚠️ **V1 DIFF:** `--served-model-name deepseek-r1-32b` added. Without it, agents receive `404 Not Found` because they query by name, not by file path.

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

### 3.2. Manual Launch (Testing)

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

**Expected output:** `Application startup complete`

---

## 4. Verification

```bash
# Is the model alias working?
curl http://localhost:8000/v1/models
# Expected: "id": "deepseek-r1-32b"

# First inference test
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-r1-32b",
    "messages": [{"role": "user", "content": "Write a Node.js function that reads a file natively."}],
    "max_tokens": 500
  }'
```

---

## 5. Failure Index — v2 New Failures

These failures were not documented in v1.0. Discovered during v2 setup.

---

### FAIL-008 — cu121 wheel not found on aarch64
**Symptom:** `ERROR: Could not find a version that satisfies the requirement torch`  
**Cause:** The cu121 index has no aarch64 binary. v1.0 was written assuming x86_64.  
**Fix:** Use `cu130` index.

---

### FAIL-009 — ncclWaitSignal undefined symbol
**Symptom:** `ImportError: libtorch_cuda.so: undefined symbol: ncclWaitSignal`  
**Cause:** The apt-installed system NCCL does not contain `ncclWaitSignal`. The pip-installed `nvidia-nccl-cu13` is not picked up by the linker.  
**Fix:**
```bash
export LD_PRELOAD=/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib/libnccl.so.2
```
Must be set before every Python invocation. Sealed as `Environment=` in the systemd service.

---

### FAIL-010 — numa.h not found
**Symptom:** `fatal error: numa.h: No such file or directory` (vLLM CPU extension)  
**Cause:** `libnuma-dev` not installed.  
**Fix:**
```bash
sudo apt-get install -y libnuma-dev
```

---

### FAIL-011 — ABI Mismatch: MessageLogger undefined symbol
**Symptom:** `ImportError: vllm/_C.abi3.so: undefined symbol: _ZN3c1013MessageLoggerC1EPKciib`  
**Cause (confirmed via `nm`):**

```
# vLLM binary expected (old signature):
U _ZN3c1013MessageLoggerC1EPKciib        ← (const char*, int, int, bool)

# PyTorch library provides (new signature):
T _ZN3c1013MessageLoggerC1ENS_14SourceLocationEib  ← (SourceLocation, int, bool)
```

pip's build isolation downloads a separate older torch into a temporary environment and uses its headers to compile vLLM. The resulting binary expects the old symbol signature. At runtime, the newer cu130 torch is found — and the signatures don't match.

**Fix:** `--no-build-isolation` with explicit `sudo -E env` injection:
```bash
sudo -E env LD_PRELOAD="..." pip3 install -e . --no-deps --no-build-isolation --break-system-packages
```

`sudo -E` alone is insufficient — pip's subprocess chain does not carry environment variables. Must use `sudo -E env VAR=value pip3` to explicitly inject into the subprocess.

---

### FAIL-012 — Agent 404: Model Not Found
**Symptom:** ANF agents send requests to vLLM and receive `404 Not Found`.  
**Cause:** vLLM serves the model under its full file path (`/home/nvidia/.cache/...`), but agents query using the name `deepseek-r1-32b`.  
**Fix:** Add `--served-model-name deepseek-r1-32b` to launch parameters.

---

## 6. Diff Table — v1.0 vs v2.0

| Parameter / Step | v1.0 | v2.0 | Why Changed |
|---|---|---|---|
| PyTorch index | `cu121` | `cu130` | No cu121 binary for aarch64 |
| libnuma-dev | Not present | Required | vLLM CPU extension dependency |
| Build method | `setup.py build_ext + pip install` | `pip install --no-build-isolation` | Prevents ABI mismatch |
| LD_PRELOAD | Runtime only | Both build and runtime | ncclWaitSignal must reach subprocess |
| `--served-model-name` | Not present | `deepseek-r1-32b` | Prevents agent 404 |
| `--gpu-memory-utilization` | `0.85` | `0.90` | systemd removes Gnome/Xorg scheduler pressure |
| Deployment | Manual terminal | systemd service | Automated restart after daily reset |

---

## Contributing to This Document

If you reproduce these steps and find a deviation — a command that no longer works, a new failure mode, or a better solution — open a GitHub Issue with the tag `setup-protocol-v2`. This document is a living field report, not a static tutorial.
