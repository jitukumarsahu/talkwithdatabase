import psycopg2
from psycopg2.extras import RealDictCursor
import pymongo
from bson import ObjectId
from datetime import datetime, date
import re
from typing import Any, Dict, List, Tuple, Union

def serialize_db_value(val: Any) -> Any:
    """Recursively converts non-serializable objects (like ObjectId, datetime, date) into serializable formats."""
    if isinstance(val, list):
        return [serialize_db_value(x) for x in val]
    if isinstance(val, dict):
        return {k: serialize_db_value(v) for k, v in val.items()}
    if isinstance(val, ObjectId):
        return str(val)
    if isinstance(val, (datetime, date)):
        return val.isoformat()
    return val

def get_mongodb_database(client: pymongo.MongoClient, connection_string: str) -> pymongo.database.Database:
    """Extracts database from URI or defaults to 'test'."""
    try:
        return client.get_default_database()
    except Exception:
        # Fallback: extract db name from URI path
        # Match pattern: mongodb://.../dbname?options
        # or mongodb+srv://.../dbname?options
        match = re.search(r'/[^/]+(?:\?|$)', connection_string)
        if match:
            db_name = match.group(0).strip('/? ')
            if db_name:
                return client[db_name]
        return client['test']

def execute_postgres(connection_string: str, query: str) -> List[Dict[str, Any]]:
    """
    Connects to PostgreSQL, runs the SQL query in a read-only transaction,
    rolls back the transaction, and returns the result rows as dictionaries.
    """
    conn = None
    cursor = None
    try:
        # Establish connection
        conn = psycopg2.connect(connection_string, connect_timeout=5)
        
        # Enforce read-only state at session level
        conn.set_session(readonly=True, autocommit=False)
        
        # Use RealDictCursor to get rows as dictionary key-value pairs
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Set transaction read-only explicitly as double protection
        cursor.execute("SET TRANSACTION READ ONLY;")
        
        # Execute query
        cursor.execute(query)
        
        # Check if query returned rows (e.g. SELECT returns rows, but EXPLAIN might too)
        results = []
        if cursor.description is not None:
            results = cursor.fetchall()
            
        # Explicit rollback to guarantee no modifications persist
        conn.rollback()
        
        return serialize_db_value(results)
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception:
                pass
        raise e
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def preprocess_ejson(val: Any) -> Any:
    """Recursively normalizes $numberObjectId to standard $oid for BSON parsing compatibility."""
    if isinstance(val, dict):
        new_dict = {}
        for k, v in val.items():
            if k == "$numberObjectId" and isinstance(v, str):
                new_dict["$oid"] = v
            else:
                new_dict[k] = preprocess_ejson(v)
        return new_dict
    elif isinstance(val, list):
        return [preprocess_ejson(x) for x in val]
    return val

def execute_mongodb(connection_string: str, query_data: Union[Dict[str, Any], str]) -> List[Dict[str, Any]]:
    """
    Connects to MongoDB Atlas dynamically, validates, and executes
    read-only operations ('find', 'find_one', 'count_documents', 'distinct', 'aggregate').
    Returns a list of serializable documents.
    """
    client = None
    try:
        # Connection
        client = pymongo.MongoClient(connection_string, serverSelectionTimeoutMS=5000)
        db = get_mongodb_database(client, connection_string)

        # If model outputs a raw string representation of a query, parse it or fail
        if isinstance(query_data, str):
            raise ValueError(
                "MongoDB query was received as a raw string. MongoDB queries must be structured "
                "JSON with 'collection', 'operation', and parameters (e.g., 'filter', 'pipeline')."
            )

        # Convert Extended JSON representations (like $oid, $date) to native BSON objects
        from bson import json_util
        query_data = preprocess_ejson(query_data)
        query_data = json_util.loads(json_util.dumps(query_data))

        collection_name = query_data.get('collection')
        if not collection_name:
            raise ValueError("MongoDB query configuration is missing the 'collection' field.")

        col = db[collection_name]
        operation = query_data.get('operation', 'find').lower()
        
        # Extract filters and options
        filter_dict = query_data.get('filter', {})
        projection_dict = query_data.get('projection', None)
        limit = query_data.get('limit', 100)
        skip = query_data.get('skip', 0)
        sort = query_data.get('sort', None)
        pipeline = query_data.get('pipeline', [])
        field = query_data.get('field', None)

        # Enforce maximum fetch limits for safety
        if limit is None or not isinstance(limit, int) or limit > 1000:
            limit = 100

        # Execute read-only query
        if operation == 'find':
            cursor = col.find(filter_dict, projection_dict)
            if sort:
                # Expecting sort in format [("field", 1), ("field2", -1)] or similar
                cursor = cursor.sort(sort)
            cursor = cursor.skip(skip).limit(limit)
            results = list(cursor)

        elif operation == 'find_one':
            res = col.find_one(filter_dict, projection_dict)
            results = [res] if res else []

        elif operation == 'count_documents':
            count = col.count_documents(filter_dict)
            results = [{"count": count}]

        elif operation == 'estimated_document_count':
            count = col.estimated_document_count()
            results = [{"count": count}]

        elif operation == 'distinct':
            if not field:
                raise ValueError("Operation 'distinct' requires a 'field' target parameter.")
            values = col.distinct(field, filter_dict)
            results = [{"distinct_values": values}]

        elif operation == 'aggregate':
            # Double check pipeline elements for $out / $merge
            for stage in pipeline:
                if not isinstance(stage, dict):
                    continue
                if '$out' in stage or '$merge' in stage:
                    raise PermissionError("Write aggregation stages ($out/$merge) are strictly prohibited.")
            
            # Enforce limit in aggregate if not specified
            has_limit = any('$limit' in stage for stage in pipeline)
            if not has_limit:
                pipeline.append({'$limit': limit})
                
            cursor = col.aggregate(pipeline)
            results = list(cursor)
        elif operation == 'db_stats':
            stats = db.command("dbStats")
            collections_info = []
            for col_name in db.list_collection_names():
                if col_name.startswith('system.'):
                    continue
                try:
                    c_stats = db.command("collStats", col_name)
                    collections_info.append({
                        "collection": col_name,
                        "document_count": c_stats.get("count", 0),
                        "size_kb": round(c_stats.get("size", 0) / 1024, 2),
                        "storage_size_kb": round(c_stats.get("storageSize", 0) / 1024, 2),
                        "indexes_count": c_stats.get("nindexes", 0)
                    })
                except Exception:
                    # Fallback in case collStats fails or isn't supported
                    doc_count = db[col_name].count_documents({})
                    collections_info.append({
                        "collection": col_name,
                        "document_count": doc_count,
                        "size_kb": "unknown",
                        "storage_size_kb": "unknown",
                        "indexes_count": "unknown"
                    })
            results = [{
                "database": db.name,
                "collections_count": stats.get("collections", len(collections_info)),
                "total_documents": stats.get("objects", sum(c["document_count"] for c in collections_info if isinstance(c["document_count"], int))),
                "data_size_kb": round(stats.get("dataSize", 0) / 1024, 2),
                "storage_size_kb": round(stats.get("storageSize", 0) / 1024, 2),
                "collections": collections_info
            }]
        else:
            raise ValueError(f"Unsupported MongoDB operation: {operation}")

        return serialize_db_value(results)
    finally:
        if client:
            client.close()
