#!/bin/bash
# לחיצה כפולה על הקובץ הזה מפעילה את האתר (מאק / לינוקס)
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js לא מותקן במחשב."
  echo "  נכנסים ל-  https://nodejs.org  ומתקינים,"
  echo "  ואז לוחצים שוב על הקובץ הזה."
  echo ""
  read -r -p "לחצו Enter לסגירה..."
  exit 1
fi

( sleep 2
  if command -v open >/dev/null 2>&1; then open http://localhost:3000
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3000
  fi ) &

node server.js
read -r -p "השרת נסגר. לחצו Enter..."
