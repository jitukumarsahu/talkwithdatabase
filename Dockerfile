FROM nikolaik/python-nodejs:python3.10-nodejs18

WORKDIR /app

# Copy the entire workspace
COPY . .

# 1. Install AI Engine (Python FastAPI) dependencies
RUN cd ai-engine && pip install --no-cache-dir -r requirements.txt

# 2. Build the React Frontend static assets
RUN cd frontend && npm install && npm run build

# 3. Install Backend API Gateway (Node.js/Express) dependencies
RUN cd backend-api && npm install

# Make start script executable
RUN chmod +x start.sh

# Expose port 7860 (Hugging Face Spaces default port)
EXPOSE 7860

# Run the startup script
CMD ["./start.sh"]
