import os
import pymongo
from pymongo import MongoClient

_client = None
_db = None

def get_db():
    global _client, _db
    if _db is not None:
        return _db
    
    mongo_uri = os.getenv("MONGODB_URI")
    if not mongo_uri:
        # Return None if MONGODB_URI is not set yet, so we don't crash
        return None
    
    try:
        _client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
        # Verify connection by calling server_info (will fail fast if unreachable)
        _client.server_info()
        
        # Get database name from URI, default to 'copilot_config'
        try:
            db_name = _client.get_default_database().name
        except Exception:
            db_name = 'copilot_config'
            
        _db = _client[db_name]
        return _db
    except Exception as e:
        print(f"Failed to connect to MongoDB Atlas: {e}")
        return None

def get_setting(key: str, default: str = None) -> str:
    try:
        db = get_db()
        if db is None:
            return default
        doc = db.settings.find_one({"key": key})
        if doc:
            return doc.get("value", default)
        return default
    except Exception as e:
        print(f"Error reading setting {key} from MongoDB: {e}")
        return default

def set_setting(key: str, value: str):
    try:
        db = get_db()
        if db is None:
            raise ValueError("MongoDB is not configured or reachable. Cannot save setting.")
        db.settings.update_one(
            {"key": key},
            {"$set": {"value": value}},
            upsert=True
        )
    except Exception as e:
        print(f"Error saving setting {key} to MongoDB: {e}")
        raise e
