#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║    APEX HUMANITY — One-Command Project Setup                 ║
# ╚══════════════════════════════════════════════════════════════╝
set -e

echo ""
echo "⚡  APEX HUMANITY — Sovereign Benevolence Protocol"
echo "    Setting up your development environment..."
echo ""

# ── Python Oracle Engine ────────────────────────────────────────
echo "🐍 Setting up SATIN Oracle (Python)..."
cd oracle
python -m venv .venv
source .venv/Scripts/activate
pip install -q -r requirements.txt
echo "   ✅ Oracle dependencies installed"
cd ..

# ── Smart Contracts ─────────────────────────────────────────────
echo "⛓️  Setting up Smart Contracts (Hardhat)..."
cd contracts
npm install -q
echo "   ✅ Contract dependencies installed"
cd ..

# ── Frontend dApp ────────────────────────────────────────────────
echo "🌐 Setting up Frontend dApp (Next.js)..."
cd frontend
npm install -q
echo "   ✅ Frontend dependencies installed"
cd ..

# ── Environment Files ────────────────────────────────────────────
if [ ! -f oracle/.env ]; then
  cat > oracle/.env << 'EOF'
ORACLE_API_KEY=apex-dev-key-change-in-prod
# ORACLE_PRIVATE_KEY=0x...   # Leave empty to use ephemeral key in dev
EOF
  echo "   📄 oracle/.env created"
fi

if [ ! -f contracts/.env ]; then
  cat > contracts/.env << 'EOF'
DEPLOYER_PRIVATE_KEY=
POLYGON_MUMBAI_RPC=https://rpc-mumbai.maticvigil.com
POLYGONSCAN_API_KEY=
ORACLE_ADDRESS=
STABLECOIN_ADDRESS=
EOF
  echo "   📄 contracts/.env created"
fi

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ✅  Setup Complete!                                     ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  Next Steps:"
echo ""
echo "  1. Start Oracle API:"
echo "     cd oracle && source .venv/Scripts/activate"
echo "     uvicorn api.main:app --reload --port 8000"
echo ""
echo "  2. Deploy contracts (local):"
echo "     cd contracts"
echo "     npx hardhat node"
echo "     npx hardhat run scripts/deploy.js --network localhost"
echo ""
echo "  3. Start dApp:"
echo "     cd frontend && npm run dev"
echo ""
echo "  4. Test the Oracle directly:"
echo "     cd oracle && python engine/impact_evaluator.py"
echo ""
echo "  📚 Docs: http://localhost:8000/docs"
echo "  🌐 dApp: http://localhost:3000"
echo ""
