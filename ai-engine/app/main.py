import os
import json
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional

from app.introspector import introspect
from app.self_healer import heal_query
from google.genai import errors
from dotenv import load_dotenv

# Load environmental variables
load_dotenv()

app = FastAPI(
    title="Dynamic DB Copilot - AI Engine",
    description="Microservice responsible for db schema introspection and safe self-healing query generation using Gemini.",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all origins in dev; restrict in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],

# Startup event
@app.on_event("startup")
def startup_event():
    """Load Gemini API Key from MongoDB on startup if present."""
    try:
        from app.database import get_setting
        db_key = get_setting("GEMINI_API_KEY")
        if db_key:
            os.environ["GEMINI_API_KEY"] = db_key
            print("Loaded GEMINI_API_KEY from MongoDB Atlas configuration database.")
    except Exception as e:
        print(f"Could not load GEMINI_API_KEY from MongoDB Atlas on startup: {e}")

# Pydantic Schemas

class IntrospectRequest(BaseModel):
    db_type: str = Field(..., description="Type of database: 'postgres' or 'mongodb'")
    connection_string: str = Field(..., description="Full connection URI credentials string")

class Message(BaseModel):
    role: str = Field(..., description="The role of the sender: 'user' or 'assistant'")
    content: str = Field(..., description="The message content text")

class QueryRequest(BaseModel):
    db_type: str = Field(..., description="Type of database: 'postgres' or 'mongodb'")
    connection_string: str = Field(..., description="Full connection URI credentials string")
    schema_context: Dict[str, Any] = Field(..., description="The schema layout metadata gathered from introspection")
    question: str = Field(..., description="Natural language question to ask the database")
    history: Optional[List[Message]] = Field(default=None, description="Recent conversation history context")

class UpdateKeyRequest(BaseModel):
    gemini_api_key: str = Field(default="", description="The new Gemini API Key to set")
    password: str = Field(..., description="Settings password required to modify server config")

class TestKeyRequest(BaseModel):
    gemini_api_key: str = Field(..., description="The Gemini API Key to validate")
    password: str = Field(..., description="Settings password required to test key")

def validate_key(api_key: str) -> tuple[bool, str | None]:
    """Tests if a Gemini API Key is valid by attempting a lightweight API call."""
    if not api_key:
        return False, "API Key is empty."
    from google import genai
    try:
        client = genai.Client(api_key=api_key)
        client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents="ping",
        )
        return True, None
    except errors.ClientError as e:
        return False, f"Invalid API Key: {e.message}"
    except Exception as e:
        return False, f"Verification failed: {str(e)}"

def update_env_file(key: str, value: str):
    """Writes or updates an environment variable inside the .env file and reloads it in-memory."""
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    lines = []
    found = False
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            lines = f.readlines()
            
    new_lines = []
    for line in lines:
        if line.strip().startswith(f"{key}="):
            new_lines.append(f"{key}={value}\n")
            found = True
        else:
            new_lines.append(line)
            
    if not found:
        if new_lines and not new_lines[-1].endswith("\n"):
            new_lines[-1] += "\n"
        new_lines.append(f"{key}={value}\n")
        
    with open(env_path, "w") as f:
        f.writelines(new_lines)
        
    os.environ[key] = value

# Endpoints

@app.get("/health")
def health_check():
    """Simple microservice status indicator."""
    return {
        "status": "healthy",
        "service": "AI Engine Microservice",
        "gemini_enabled": os.getenv("GEMINI_API_KEY") is not None
    }

@app.post("/api/introspect")
def api_introspect(payload: IntrospectRequest):
    """
    Connects dynamically to the specified database using credentials,
    introspects the structural schemas/collections, and returns metadata.
    """
    try:
        schema = introspect(payload.db_type, payload.connection_string)
        return schema
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Introspection failed: {str(e)}"
        )

@app.post("/api/query")
def api_query(payload: QueryRequest):
    """
    Translates, validates, and executes a natural language query on the
    target database, running self-healing up to 3 times on failure.
    """
    if not os.getenv("GEMINI_API_KEY"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gemini API Key is not configured on the AI Engine server."
        )
        
    try:
        history_list = [{"role": m.role, "content": m.content} for m in payload.history] if payload.history else None
        response = heal_query(
            db_type=payload.db_type,
            connection_string=payload.connection_string,
            schema_context=payload.schema_context,
            question=payload.question,
            history=history_list
        )
        return response
    except errors.ClientError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Gemini API Client Error: {e.message}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Self-healer execution failed: {str(e)}"
        )

@app.get("/api/config/key/status")
def get_key_status():
    """Gets the current status of the GEMINI_API_KEY config (masked key and validity)."""
    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        try:
            from app.database import get_setting
            api_key = get_setting("GEMINI_API_KEY", "")
            if api_key:
                os.environ["GEMINI_API_KEY"] = api_key
        except Exception:
            pass
            
    if not api_key:
        return {
            "status": "missing",
            "masked_key": "None",
            "error_message": "GEMINI_API_KEY environment variable is not configured."
        }
    
    # Check if the key is valid
    is_valid, err = validate_key(api_key)
    
    # Mask the key (e.g. AQ.Ab8R...yFQ)
    masked_key = "None"
    if len(api_key) > 10:
        masked_key = f"{api_key[:7]}...{api_key[-3:]}"
    elif api_key:
        masked_key = "***"
        
    return {
        "status": "configured" if is_valid else "invalid",
        "masked_key": masked_key,
        "error_message": err
    }

SETTINGS_PASSWORD = "Jitu@9178"

@app.post("/api/config/key/test")
def test_gemini_key(payload: TestKeyRequest):
    """Checks the validity of a proposed GEMINI_API_KEY without saving it."""
    if payload.password != SETTINGS_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Incorrect settings password."
        )
    is_valid, err = validate_key(payload.gemini_api_key)
    return {
        "valid": is_valid,
        "message": err
    }

@app.post("/api/config/key")
def update_gemini_key(payload: UpdateKeyRequest):
    """Updates the GEMINI_API_KEY in MongoDB and reloads it in-memory."""
    if payload.password != SETTINGS_PASSWORD:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Incorrect settings password."
        )
    api_key = payload.gemini_api_key.strip()
    
    from app.database import set_setting
    
    # If the key is empty, clear it
    if not api_key:
        try:
            set_setting("GEMINI_API_KEY", "")
            os.environ["GEMINI_API_KEY"] = ""
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to clear key in database: {str(e)}"
            )
        return {
            "success": True,
            "message": "GEMINI_API_KEY has been cleared.",
            "valid": False
        }
        
    # Validate the key first
    is_valid, err = validate_key(api_key)
    
    # Update the key in MongoDB and in-memory environment
    try:
        set_setting("GEMINI_API_KEY", api_key)
        os.environ["GEMINI_API_KEY"] = api_key
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save key to MongoDB: {str(e)}"
        )
    
    return {
        "success": True,
        "message": "GEMINI_API_KEY has been updated." if is_valid else "GEMINI_API_KEY has been updated, but validation failed.",
        "valid": is_valid,
        "error": err
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Starting AI Engine microservice on port {port}...")
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
