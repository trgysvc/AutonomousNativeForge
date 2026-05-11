#!/usr/bin/env python3
import sys

service = '/etc/systemd/system/vllm-nemotron.service'

execstart = '/usr/bin/python3 -m vllm.entrypoints.openai.api_server'
execstart += ' --model /home/nvidia/.cache/models/nemotron-super-120b-nvfp4'
execstart += ' --served-model-name nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4'
execstart += ' --quantization nvfp4'
execstart += ' --kv-cache-dtype fp8'
execstart += ' --tensor-parallel-size 1'
execstart += ' --max-model-len 32768'
execstart += ' --gpu-memory-utilization 0.70'
execstart += ' --reasoning-parser nemotron_v3'
execstart += ' --enable-auto-tool-choice'
execstart += ' --tool-call-parser hermes'
execstart += ' --port 8000'
execstart += ' --trust-remote-code'

ld = '/usr/local/lib/python3.12/dist-packages/torch/lib'
ld += ':/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib'
ld += ':/usr/local/cuda-13.2/targets/sbsa-linux/lib'
ld += ':/usr/local/cuda-13.2/lib64'

lp = '/usr/local/lib/python3.12/dist-packages/nvidia/nccl/lib/libnccl.so.2'

content = '\n'.join([
    '[Unit]',
    'Description=vLLM Nemotron-Super-120B NVFP4 Blackwell Service',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    'User=nvidia',
    'WorkingDirectory=/home/nvidia/vllm',
    'Environment="PYTHONPATH=/home/nvidia/vllm"',
    'Environment="VLLM_TARGET_DEVICE=cuda"',
    'Environment="VLLM_NVFP4_GEMM_BACKEND=marlin"',
    'Environment="VLLM_ALLOW_LONG_MAX_MODEL_LEN=1"',
    'Environment="LD_PRELOAD=' + lp + '"',
    'Environment="LD_LIBRARY_PATH=' + ld + '"',
    'ExecStart=' + execstart,
    'Restart=always',
    'RestartSec=10',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
]) + '\n'

try:
    with open(service, 'w') as f:
        f.write(content)
    print('OK: ' + service)
except PermissionError:
    print('HATA: sudo ile calistir')
    sys.exit(1)
