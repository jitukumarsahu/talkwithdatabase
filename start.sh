#!/bin/bash

# Start the Python AI Engine in the background on port 8000
echo "Starting AI Engine on port 8000..."
cd /app/ai-engine
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &

# Wait 3 seconds for the AI Engine to initialize
sleep 3

# Start the Express API Gateway in the foreground on port 7860
echo "Starting API Gateway on port 7860..."
cd /app/backend-api
PORT=7860 AI_ENGINE_URL=http://127.0.0.1:8000 node src/server.js
