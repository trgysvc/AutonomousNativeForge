#!/bin/bash
# ANF Standalone Backup Script
# Created: 2026-05-13

# Proje dizinine git
cd /workspaces/AutonomousNativeForge

# Dosya değişikliklerini tara
git add .

# Eğer değişiklik varsa commit at (Değişiklik yoksa hata vermemesi için || true kullanıyoruz)
git commit -m "Auto-backup: $(date +'%Y-%m-%d %H:%M:%S')" || true

# GitHub'a pushla (Auth'un önceden yapılmış olduğu varsayılıyor)
git push origin main --quiet

echo "[$(date)] Backup completed successfully."
