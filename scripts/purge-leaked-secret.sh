#!/bin/bash
#
# Purge Leaked MongoDB Credentials from Git History
#
# This script uses git-filter-repo to remove the file containing leaked credentials
# from all git history, including all branches and tags.
#
# DANGER: This rewrites git history and requires force-push to remote.
# Coordinate with all team members before running this script.
#
# Prerequisites:
#   - Install git-filter-repo: pip install git-filter-repo
#   - Backup your repository first
#   - Coordinate with team (this will require everyone to re-clone)
#
# Usage:
#   ./scripts/purge-leaked-secret.sh
#

set -e

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${BLUE}  AFI Reactor - Purge Leaked Secret from Git History${NC}"
echo "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if git-filter-repo is installed
if ! command -v git-filter-repo &> /dev/null; then
  echo "${RED}✗ git-filter-repo is not installed${NC}"
  echo ""
  echo "Install it with:"
  echo "  ${YELLOW}pip install git-filter-repo${NC}"
  echo ""
  echo "Or on macOS:"
  echo "  ${YELLOW}brew install git-filter-repo${NC}"
  echo ""
  exit 1
fi

# Confirm with user
echo "${YELLOW}⚠️  WARNING: This will rewrite git history!${NC}"
echo ""
echo "This script will:"
echo "  1. Remove 'start-server-with-mongo.sh' from ALL commits"
echo "  2. Rewrite ALL branches and tags"
echo "  3. Require force-push to remote"
echo "  4. Require all team members to re-clone the repository"
echo ""
echo "Before proceeding:"
echo "  ✓ Backup your repository"
echo "  ✓ Coordinate with all team members"
echo "  ✓ Ensure you have rotated the leaked credentials"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "${YELLOW}Aborted.${NC}"
  exit 0
fi

echo ""
echo "${BLUE}Step 1: Creating backup...${NC}"
BACKUP_DIR="../afi-reactor-backup-$(date +%Y%m%d-%H%M%S)"
cp -r . "$BACKUP_DIR"
echo "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}"

echo ""
echo "${BLUE}Step 2: Removing start-server-with-mongo.sh from history...${NC}"
git-filter-repo --path start-server-with-mongo.sh --invert-paths --force

echo "${GREEN}✓ File removed from history${NC}"

echo ""
echo "${BLUE}Step 3: Verifying removal...${NC}"
if git log --all --oneline --source --full-history -S "J2WR2u2yIYhGREFF" 2>/dev/null | grep -q "J2WR2u2yIYhGREFF"; then
  echo "${RED}✗ Secret still found in history!${NC}"
  echo "Manual cleanup may be required."
  exit 1
else
  echo "${GREEN}✓ Secret not found in history${NC}"
fi

echo ""
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "${GREEN}✓ History cleanup complete!${NC}"
echo "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. ${YELLOW}Review the changes:${NC}"
echo "   git log --oneline --all | head -20"
echo ""
echo "2. ${YELLOW}Add back the remote (git-filter-repo removes it):${NC}"
echo "   git remote add origin git@github.com:AFI-Protocol/afi-reactor.git"
echo ""
echo "3. ${YELLOW}Force-push to GitHub:${NC}"
echo "   git push origin --force --all"
echo "   git push origin --force --tags"
echo ""
echo "4. ${YELLOW}Notify team members to re-clone:${NC}"
echo "   rm -rf afi-reactor"
echo "   git clone git@github.com:AFI-Protocol/afi-reactor.git"
echo ""
echo "5. ${YELLOW}Verify on GitHub that the secret is gone:${NC}"
echo "   Check commit d01b5d0 (should not exist or should not contain the file)"
echo ""
echo "${BLUE}Backup location: $BACKUP_DIR${NC}"
echo ""

