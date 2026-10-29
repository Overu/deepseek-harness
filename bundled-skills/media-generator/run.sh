#!/bin/bash
# Media Generator 快捷调用脚本
# PYTHONDONTWRITEBYTECODE: 避免在受限沙箱下写 __pycache__ 触发权限错误
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PYTHONDONTWRITEBYTECODE=1
exec python3 "$SCRIPT_DIR/generate.py" "$@"
