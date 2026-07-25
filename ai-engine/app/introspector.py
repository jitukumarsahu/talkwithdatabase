import psycopg2
from psycopg2.extras import RealDictCursor
import pymongo
from typing import Any, Dict, List

def introspect_postgres(connection_string: str) -> Dict[str, Any]:
    """
    Connects to a PostgreSQL database and extracts the database schema:
    - Tables
    - Columns (name, data type, nullability)
    - Foreign key relations
    """
    conn = None
    cursor = None
    try:
        conn = psycopg2.connect(connection_string, connect_timeout=5)
        conn.set_session(readonly=True, autocommit=True)
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # 1. Fetch tables and columns
        columns_query = """
            SELECT 
                t.table_schema,
                t.table_name,
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.ordinal_position
            FROM 
                information_schema.tables t
            JOIN 
                information_schema.columns c ON t.table_name = c.table_name AND t.table_schema = c.table_schema
            WHERE 
                t.table_schema NOT IN ('pg_catalog', 'information_schema')
                AND t.table_type = 'BASE TABLE'
            ORDER BY 
                t.table_schema, t.table_name, c.ordinal_position;
        """
        cursor.execute(columns_query)
        columns_raw = cursor.fetchall()
        
        # 2. Fetch foreign key relations
        relations_query = """
            SELECT
                tc.table_schema, 
                tc.table_name, 
                kcu.column_name, 
                ccu.table_schema AS foreign_table_schema,
                ccu.table_name AS foreign_table_name,
                ccu.column_name AS foreign_column_name 
            FROM 
                information_schema.table_constraints AS tc 
                JOIN information_schema.key_column_usage AS kcu
                  ON tc.constraint_name = kcu.constraint_name
                  AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                  ON ccu.constraint_name = tc.constraint_name
                  AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY';
        """
        cursor.execute(relations_query)
        relations_raw = cursor.fetchall()
        
        # Structure the metadata
        tables_dict = {}
        for col in columns_raw:
            schema_table = f"{col['table_schema']}.{col['table_name']}" if col['table_schema'] != 'public' else col['table_name']
            if schema_table not in tables_dict:
                tables_dict[schema_table] = {
                    "schema": col['table_schema'],
                    "name": col['table_name'],
                    "columns": []
                }
            tables_dict[schema_table]["columns"].append({
                "name": col['column_name'],
                "type": col['data_type'],
                "nullable": col['is_nullable'] == 'YES'
            })
            
        relations = []
        for rel in relations_raw:
            rel_src = f"{rel['table_schema']}.{rel['table_name']}" if rel['table_schema'] != 'public' else rel['table_name']
            rel_dst = f"{rel['foreign_table_schema']}.{rel['foreign_table_name']}" if rel['foreign_table_schema'] != 'public' else rel['foreign_table_name']
            relations.append({
                "from_table": rel_src,
                "from_column": rel['column_name'],
                "to_table": rel_dst,
                "to_column": rel['foreign_column_name']
            })
            
        return {
            "db_type": "postgres",
            "tables": list(tables_dict.values()),
            "relations": relations
        }
        
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()

def introspect_mongodb(connection_string: str) -> Dict[str, Any]:
    """
    Connects to a MongoDB database and extracts:
    - Collections
    - Inferred schema for each collection (inspecting a few sample documents)
    """
    from concurrent.futures import ThreadPoolExecutor
    client = None
    try:
        client = pymongo.MongoClient(connection_string, serverSelectionTimeoutMS=5000)
        
        # Helper to get db name
        try:
            db = client.get_default_database()
        except Exception:
            import re
            match = re.search(r'/[^/]+(?:\?|$)', connection_string)
            db_name = match.group(0).strip('/? ') if match else 'test'
            db = client[db_name]
            
        collections_meta = list(db.list_collections())
        
        def introspect_collection(col_info):
            col_name = col_info['name']
            if col_name.startswith('system.'):
                return None
                
            col = db[col_name]
            
            # Fetch up to 5 documents to infer keys, with a 1-second query timeout
            try:
                sample_docs = list(col.find().max_time_ms(1000).limit(5))
            except Exception:
                # Silently ignore read/timeout failures on views or collections lacking permissions
                sample_docs = []
                
            schema = {}
            for doc in sample_docs:
                for key, val in doc.items():
                    val_type = type(val).__name__
                    if isinstance(val, dict):
                        schema[key] = {
                            "type": "Object",
                            "fields": list(val.keys())
                        }
                    elif isinstance(val, list):
                        if val:
                            schema[key] = {
                                "type": f"Array of {type(val[0]).__name__}"
                            }
                        else:
                            schema[key] = {"type": "Array"}
                    else:
                        if key not in schema or not isinstance(schema[key], dict) or "samples" not in schema[key]:
                            schema[key] = {
                                "type": val_type,
                                "samples": set()
                            }
                        if isinstance(val, (str, int, float, bool)) and len(str(val)) < 80:
                            schema[key]["samples"].add(val)
            
            # Convert sets to lists for JSON serialization
            for key, field_meta in schema.items():
                if isinstance(field_meta, dict) and "samples" in field_meta:
                    field_meta["samples"] = list(field_meta["samples"])
            
            return {
                "name": col_name,
                "fields": schema,
                "sample_count": len(sample_docs)
            }
            
        # Perform introspection concurrently with a thread pool
        with ThreadPoolExecutor(max_workers=20) as executor:
            collections_schema = list(executor.map(introspect_collection, collections_meta))
            
        # Filter out system collections (None values)
        collections_schema = [c for c in collections_schema if c is not None]
            
        return {
            "db_type": "mongodb",
            "database_name": db.name,
            "collections": collections_schema
        }
        
    finally:
        if client:
            client.close()

def introspect(db_type: str, connection_string: str) -> Dict[str, Any]:
    """Routes schema introspection request to the correct database engine."""
    db_type_lower = db_type.lower()
    if db_type_lower in ('postgres', 'postgresql'):
        return introspect_postgres(connection_string)
    elif db_type_lower in ('mongo', 'mongodb'):
        return introspect_mongodb(connection_string)
    else:
        raise ValueError(f"Unsupported database type for introspection: {db_type}")
