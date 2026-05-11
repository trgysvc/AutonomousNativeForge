#!/usr/bin/env python3
import json, sys

vault_path = '/workspaces/AutonomousNativeForge/config/vault.json'

try:
    with open(vault_path, 'r') as f:
        vault = json.load(f)

    old_timeout = vault['global'].get('nim_timeout_ms')
    old_budget = vault['global']['nim_reasoning_budgets'].get('ARCHITECT')

    vault['global']['nim_timeout_ms'] = 1200000
    vault['global']['nim_reasoning_budgets']['ARCHITECT'] = 6144

    with open(vault_path, 'w') as f:
        json.dump(vault, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f'OK: nim_timeout_ms  {old_timeout} -> 1200000 (20 dk)')
    print(f'OK: ARCHITECT budget {old_budget} -> 6144 token')
    print('Simdi ANF restart: systemctl --user restart anf-architect')

except FileNotFoundError:
    print(f'HATA: {vault_path} bulunamadi')
    sys.exit(1)
except PermissionError:
    print('HATA: Yetki hatasi')
    sys.exit(1)
