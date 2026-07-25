import os
import json
import traceback
from typing import Any, Dict, List, Optional, Tuple, Union
from google import genai
from google.genai import types, errors
from pydantic import BaseModel, Field

from app.security import validate_sql_query, validate_mongo_query
from app.executor import execute_postgres, execute_mongodb

# Gemini JSON schemas for structured output (defined as dictionaries to bypass google-genai Pydantic validation bugs)

SQL_JSON_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "query": {
            "type": "STRING",
            "description": "The read-only SELECT/WITH SQL query to execute. Do not include markdown formatting."
        },
        "explanation": {
            "type": "STRING",
            "description": "A brief explanation of what the query does."
        }
    },
    "required": ["query", "explanation"]
}

MONGO_JSON_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "collection": {
            "type": "STRING",
            "description": "The name of the MongoDB collection to query. If the operation is db_stats, set this to 'database'."
        },
        "operation": {
            "type": "STRING",
            "description": "The MongoDB operation. Allowed: find, find_one, count_documents, estimated_document_count, distinct, aggregate, db_stats"
        },
        "filter": {
            "type": "OBJECT",
            "description": "Query filter criteria, e.g. {'age': {'$gt': 21}}"
        },
        "projection": {
            "type": "OBJECT",
            "description": "Fields to return/project, e.g. {'name': 1, 'email': 1}"
        },
        "sort": {
            "type": "ARRAY",
            "description": "Sort specification list, e.g. [['age', 1]]",
            "items": {
                "type": "ARRAY",
                "items": {
                    "type": "STRING"
                }
            }
        },
        "limit": {
            "type": "INTEGER",
            "description": "Max documents to return (max 1000)."
        },
        "skip": {
            "type": "INTEGER",
            "description": "Number of documents to skip."
        },
        "pipeline": {
            "type": "ARRAY",
            "description": "Aggregation pipeline stages (required if operation is aggregate).",
            "items": {
                "type": "OBJECT"
            }
        },
        "field": {
            "type": "STRING",
            "description": "Target field name (required if operation is distinct)."
        },
        "explanation": {
            "type": "STRING",
            "description": "A brief explanation of what the query does."
        }
    },
    "required": ["collection", "operation", "explanation"]
}


def get_gemini_client() -> genai.Client:
    """Initializes the Google GenAI Client using the environment API key."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set. Please set it in your environment.")
    return genai.Client(api_key=api_key)

def build_postgres_system_instruction(schema_context: Dict[str, Any]) -> str:
    """Builds a database-aware instruction prompt for PostgreSQL SQL generation."""
    tables_info = []
    for table in schema_context.get("tables", []):
        col_strings = [f"{col['name']} ({col['type']}{', nullable' if col['nullable'] else ''})" for col in table.get("columns", [])]
        tables_info.append(f"- Table: {table['name']}\n  Columns: {', '.join(col_strings)}")
        
    relations_info = []
    for rel in schema_context.get("relations", []):
        relations_info.append(f"  * {rel['from_table']}.{rel['from_column']} -> {rel['to_table']}.{rel['to_column']}")
        
    relations_str = "\n".join(relations_info) if relations_info else "None defined."
    
    return f"""You are a senior PostgreSQL database administrator. Your task is to generate a read-only SQL query to answer the user's natural language question.

DATABASE SCHEMA DETAILS:
{chr(10).join(tables_info)}

FOREIGN KEY RELATIONSHIPS:
{relations_str}

CRITICAL RULES:
1. Generate only a SELECT or WITH statement. Do NOT perform any mutations (INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, etc.).
2. You must strictly match table names and column names as defined in the schema.
3. Be careful with PostgreSQL case-sensitivity. Double quote identifiers only if necessary or if they contain capital letters/spaces.
4. Avoid using table joins on columns that are not compatible in type.
5. If the user request cannot be answered with the given schema, explain why in your explanation and output a generic safe SELECT query.
6. If the user's question is off-topic or unrelated to the database (e.g., general knowledge questions, general coding questions, writing questions like 'what is Python', etc.), you MUST set the explanation field to exactly 'I am specialized to answer database-related questions only.' and return a mock SELECT statement.
7. If the user asks to perform database mutations, updates, insertions, deletions, or schema alterations (e.g., inserting data, updating rows, deleting rows, dropping tables, altering columns), you MUST set the explanation field to exactly 'I am specialized in retrieving data only, and I cannot perform updates, insertions, or deletions.' and return a generic safe SELECT query.
"""

def build_mongo_system_instruction(schema_context: Dict[str, Any]) -> str:
    """Builds a database-aware instruction prompt for MongoDB query structure generation."""
    collections_info = []
    for col in schema_context.get("collections", []):
        field_parts = []
        for k, v in col.get("fields", {}).items():
            field_desc = f"{k} ({v.get('type')}"
            samples = v.get("samples")
            if samples:
                field_desc += f", samples: {samples}"
            field_desc += ")"
            field_parts.append(field_desc)
        fields_str = ", ".join(field_parts)
        collections_info.append(f"- Collection: {col['name']}\n  Fields: {fields_str}")
        
    return f"""You are a senior MongoDB developer. Your task is to generate a read-only MongoDB query configuration structure to answer the user's natural language question.

DATABASE COLLECTIONS DETAILS:
{chr(10).join(collections_info)}

CRITICAL QUERY GENERATION RULES (FOR 100% ACCURACY):
1. Allowed Read-Only Operations: Choose from find, find_one, count_documents, estimated_document_count, distinct, aggregate, db_stats.
2. Safe Execution: Never generate mutation or write operations (insert, update, delete, drop, merge, etc.).
3. Schema Adherence: Only query fields that explicitly exist in the collection schema. Use dot notation for nested objects (e.g. 'doctorProfile.specialization').
4. Structured Output: You must output a structured JSON response matching the provided schema.
5. Identify Constraints: Carefully analyze the natural language query for filtering constraints (such as roles, statuses, flags, states, categories, types, names):
   - Inspect the 'samples' list provided in the schema for string fields to see if the user's requested entity (e.g., "doctor" or "admin") is contained as a value inside that field.
   - Map constraints to the target field in the collection schema based on the sample values (e.g., matching "doctor" or "patient" to the `role` field because "Doctor" is listed in its samples; matching "cancelled" or "completed" to the `status` field).
   - If a constraint is present in the question, you MUST populate the `filter` object to restrict the documents. NEVER return an empty filter `{{}}` when constraints are requested.
6. Case-Insensitive Matching for String Constants: Database status/role string values often have capitalizations (e.g. "Cancelled", "doctor", "Doctor", "Completed").
   - To achieve 100% accuracy in matching user keywords, always match status/role string values using a case-insensitive regular expression pattern.
   - Example format for status/role matching: `{{"fieldName": {{"$regex": "^target_value$", "$options": "i"}}}}`.
   - For example:
     - For "cancelled appointments": filter on `appointments` should be `{{"status": {{"$regex": "^cancelled$", "$options": "i"}}}}`.
     - For "doctors" or "patients": filter on `users` should be `{{"role": {{"$regex": "^doctor$", "$options": "i"}}}}` or `{{"role": {{"$regex": "^patient$", "$options": "i"}}}}`.
7. Database-Wide Meta Queries: If the user asks for a brief, summary, details, structure, or stats of the entire database or its files as a whole:
   - Set the `operation` to `"db_stats"`.
   - Set the `collection` to `"database"`.
8. Domain Guardrail (Off-Topic Questions): If the user's question is off-topic or unrelated to the database or its collections/schema (e.g. general knowledge questions, general programming/coding, what is Python, recipes, etc.), you MUST set the `explanation` field to exactly: "I am specialized to answer database-related questions only." and set `operation` to `db_stats`, `collection` to `"database"`, and `filter` to `{{}}`.
9. Lookup joins (Aggregation): If the query requires checking relationships between collections (e.g. matching an appointments' patientId to a users' _id) and you do NOT see the target entity's `_id` inside the CONVERSATION HISTORY's `[Database Results: ...]`, you MUST perform a lookup join:
   - Set the `operation` to `"aggregate"`.
   - Set the `collection` to the primary collection (e.g., `"appointments"`).
   - Use the `pipeline` array parameter to perform `$lookup`, `$match`, and optionally `$count` stages.
   - NEVER use `operation: "count_documents"` or `operation: "find"` with a `pipeline` property, as those operations do not support pipelines.
10. Querying by ID from History: Check the CONVERSATION HISTORY carefully. If a previous turn queried the target user/document (e.g. Ram or Laltu) and returned its `_id` inside `[Database Results: ...]`, you MUST extract that `_id` value (e.g., `"6a2f7b9139b71e3b09165981"`) and filter by `patientId` (or `doctorId`, `userId` etc.) using {{"patientId": {{"$oid": "EXTRACTED_ID"}}}} directly in a simple `count_documents` or `find` filter! This is highly preferred over a lookup join.
11. Mutating Queries Guardrail: If the user asks to perform database modifications, insertions, updates, deletions, or schema alterations (e.g. inserting documents, updating fields, deleting documents, dropping collections), you MUST set the `explanation` field to exactly: "I am specialized in retrieving data only, and I cannot perform updates, insertions, or deletions." and set `operation` to `db_stats`, `collection` to `"database"`, and `filter` to `{{}}`.

FEW-SHOT EXAMPLES FOR CONSTRAINTS:

Example 1:
User Question: how many patients are in the system
Schema collections details:
- Collection: users
  Fields: _id (ObjectId), name (str), role (str, samples: ['SuperAdmin', 'Admin', 'Patient']), doctorProfile (Object)

Your structured JSON output:
{{
  "collection": "users",
  "operation": "count_documents",
  "explanation": "Count the number of users whose role is Patient.",
  "filter": {{
    "role": {{
      "$regex": "^patient$",
      "$options": "i"
    }}
  }}
}}

Example 2:
User Question: Find products with low inventory less than 10
Schema collections details:
- Collection: products
  Fields: _id (ObjectId), title (str), inventory (int, samples: [2, 5, 20])

Your structured JSON output:
{{
  "collection": "products",
  "operation": "find",
  "explanation": "Query the products collection for items with inventory less than 10.",
  "filter": {{
    "inventory": {{
      "$lt": 10
    }}
  }}
}}
"""

def generate_conversational_answer(
    client: genai.Client,
    model_name: str,
    question: str,
    query: Any,
    results: Any,
    db_type: str,
    history: Optional[List[Dict[str, str]]] = None
) -> str:
    """
    Uses Gemini to generate a user-friendly, conversational text answer
    based on the database query results and user's question, keeping history context in mind.
    """
    system_instruction = f"""You are a helpful, senior database copilot assistant. Your task is to provide a clear, concise, conversational, and direct answer to the user's current question, based ONLY on the provided database query results.
    
    CRITICAL RULES:
    1. Summarize the results in a natural reading format (e.g., lists, bullet points, or short paragraphs) as a human would. Do not output raw JSON or database grids.
    2. If the results are empty, explain that no records matched their request in a helpful tone.
    3. If there are names, numbers, or dates, format them nicely (e.g., convert amounts to currency if appropriate, format dates cleanly) and copy them exactly from the database results.
    4. Keep the tone friendly, professional, and developer-oriented. Feel free to use markdown bolding and line breaks for layout structure.
    5. Do not include metadata, technical debugging info, or query code in this text response unless asked. Focus solely on answering the user's question directly.
    """
    
    prompt = ""
    if history:
        prompt += "CONVERSATION HISTORY:\n"
        for msg in history:
            role_label = "User" if msg.get("role") == "user" else "Assistant"
            prompt += f"{role_label}: {msg.get('content')}\n"
        prompt += "\n"
        
    prompt += f"Current User Question: {question}\n\n"
    prompt += f"Executed {db_type.upper()} Query:\n"
    prompt += f"{json.dumps(query) if isinstance(query, dict) else query}\n\n"
    prompt += f"Database Query Results:\n{json.dumps(results, indent=2)}\n\n"
    prompt += "Answer:"
    
    try:
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.3
            )
        )
        return response.text.strip()
    except Exception as e:
        return f"Query executed successfully, but failed to generate a conversational summary: {str(e)}"

def heal_query(
    db_type: str,
    connection_string: str,
    schema_context: Dict[str, Any],
    question: str,
    history: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]:
    """
    Executes the self-healing loop up to 3 times:
    1. Requests Gemini to generate query (via structured output schema).
    2. Validates against security.py.
    3. Attempts execution via executor.py.
    4. On error, feeds back exception context to Gemini and retries.
    """
    db_type_lower = db_type.lower()
    is_postgres = db_type_lower in ('postgres', 'postgresql')
    
    client = get_gemini_client()
    model_name = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    
    # Configure system instructions and schemas based on DB type
    if is_postgres:
        system_instruction = build_postgres_system_instruction(schema_context)
        response_schema = SQL_JSON_SCHEMA
    else:
        system_instruction = build_mongo_system_instruction(schema_context)
        response_schema = MONGO_JSON_SCHEMA
        
    attempts_log = []
    error_feedback = ""
    
    for attempt in range(1, 4):
        attempt_record = {
            "attempt": attempt,
            "status": "pending",
            "query": None,
            "error": None,
            "explanation": ""
        }
        
        # Build prompt
        prompt = ""
        if history:
            prompt += "CONVERSATION HISTORY:\n"
            for msg in history:
                role_label = "User" if msg.get("role") == "user" else "Assistant"
                prompt += f"{role_label}: {msg.get('content')}\n"
            prompt += "\n"
        
        prompt += f"User Question: {question}\n"
        if attempt > 1:
            prompt += f"\n[HEALING ITERATION - PREVIOUS ATTEMPT FAILED]\n"
            prompt += f"Your previous generated query: {json.dumps(attempts_log[-1]['query'])}\n"
            prompt += f"It failed with the following error:\n{error_feedback}\n"
            prompt += f"Please inspect the database schema carefully, fix the issue (e.g., correct a join, column name, cast types, or query filters), and re-generate a correct query.\n"

        try:
            # Call Gemini
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=response_schema if is_postgres else None,
                    temperature=0.1 # Low temperature for more deterministic/logical code gen
                )
            )
            
            # Parse structured output
            raw_response = json.loads(response.text)
            explanation = raw_response.get("explanation", "")
            
            # Check for off-topic domain guardrail or mutation requests
            explanation_lower = explanation.lower() if explanation else ""
            if explanation_lower and ("specialized in retrieving data only" in explanation_lower or "cannot perform updates" in explanation_lower or "deletions" in explanation_lower):
                polite_msg = "I am specialized in retrieving data only, and I cannot perform updates, insertions, or deletions."
                attempt_record["explanation"] = polite_msg
                attempt_record["query"] = raw_response
                attempt_record["status"] = "success"
                attempts_log.append(attempt_record)
                return {
                    "success": False,
                    "db_type": db_type_lower,
                    "query": None,
                    "explanation": polite_msg,
                    "conversational_answer": polite_msg,
                    "results": [{"message": polite_msg}],
                    "attempts": attempts_log
                }

            if explanation_lower and ("specialized to answer database-related questions only" in explanation_lower or "specialized to answer database-related" in explanation_lower):
                attempt_record["explanation"] = "I am specialized to answer database-related questions only."
                attempt_record["query"] = raw_response
                attempt_record["status"] = "success"
                attempts_log.append(attempt_record)
                return {
                    "success": False,
                    "db_type": db_type_lower,
                    "query": None,
                    "explanation": "I am specialized to answer database-related questions only.",
                    "conversational_answer": "I am specialized to answer database-related questions only.",
                    "results": [{"message": "I am specialized to answer database-related questions only."}],
                    "attempts": attempts_log
                }
                
            if is_postgres:
                generated_query = raw_response.get("query", "").strip()
                attempt_record["query"] = generated_query
                attempt_record["explanation"] = explanation
                
                # 1. Security Check
                is_safe, sec_err = validate_sql_query(generated_query)
                if not is_safe:
                    raise PermissionError(sec_err)
                    
                # 2. Database Execution
                results = execute_postgres(connection_string, generated_query)
                
            else:
                # MongoDB
                explanation = raw_response.get("explanation", "")
                # Clean up response payload to ensure it matches MongoQueryResponse structure
                mongo_payload = {
                    "collection": raw_response.get("collection"),
                    "operation": raw_response.get("operation", "find"),
                    "filter": raw_response.get("filter"),
                    "projection": raw_response.get("projection"),
                    "sort": raw_response.get("sort"),
                    "limit": raw_response.get("limit", 100),
                    "skip": raw_response.get("skip", 0),
                    "pipeline": raw_response.get("pipeline"),
                    "field": raw_response.get("field")
                }
                # Remove None fields
                mongo_payload = {k: v for k, v in mongo_payload.items() if v is not None}
                
                attempt_record["query"] = mongo_payload
                attempt_record["explanation"] = explanation
                
                # 1. Security Check
                is_safe, sec_err = validate_mongo_query(mongo_payload)
                if not is_safe:
                    raise PermissionError(sec_err)
                    
                # 2. Database Execution
                results = execute_mongodb(connection_string, mongo_payload)
                
            # Generate the conversational answer
            conversational_answer = generate_conversational_answer(
                client=client,
                model_name=model_name,
                question=question,
                query=attempt_record["query"],
                results=results,
                db_type=db_type_lower,
                history=history
            )
            
            # If we reach here, execution succeeded!
            attempt_record["status"] = "success"
            attempts_log.append(attempt_record)
            
            return {
                "success": True,
                "db_type": db_type_lower,
                "query": attempt_record["query"],
                "explanation": explanation,
                "results": results,
                "conversational_answer": conversational_answer,
                "attempts": attempts_log
            }
            
        except errors.ClientError as e:
            # ClientError represents invalid key, expired key, invalid model, quota exceeded, etc.
            # We raise/propagate it immediately to avoid useless retry attempts.
            raise e
        except PermissionError as e:
            # PermissionError represents security validation checks failing (e.g. mutation queries)
            # We abort immediately and return a polite error message.
            polite_msg = "I am specialized in retrieving data only, and I cannot perform updates, insertions, or deletions."
            attempt_record["status"] = "failed"
            attempt_record["error"] = str(e)
            attempt_record["explanation"] = polite_msg
            attempts_log.append(attempt_record)
            return {
                "success": False,
                "db_type": db_type_lower,
                "query": attempt_record["query"],
                "explanation": polite_msg,
                "conversational_answer": polite_msg,
                "results": [{"message": polite_msg}],
                "attempts": attempts_log
            }
        except Exception as e:
            # Capture error details
            err_msg = str(e)
            # Shorten traceback to avoid prompt bloat, but get the essential database message
            trace_str = traceback.format_exc()
            error_feedback = f"{err_msg}\nTrace:\n{trace_str.splitlines()[-3:]}"
            
            attempt_record["status"] = "failed"
            attempt_record["error"] = err_msg
            
            # If we got a query, save it in the attempt log, otherwise save raw response text if parsed
            if not attempt_record["query"]:
                try:
                    attempt_record["query"] = json.loads(response.text)
                except Exception:
                    attempt_record["query"] = response.text if 'response' in locals() else "Query generation failed"
                    
            attempts_log.append(attempt_record)
            
    # If we exit the loop, all 3 attempts failed
    return {
        "success": False,
        "db_type": db_type_lower,
        "query": attempts_log[-1]["query"] if attempts_log else None,
        "error": attempts_log[-1]["error"] if attempts_log else "Failed to generate query",
        "conversational_answer": f"Failed to execute database query after 3 self-healing attempts. Error: {attempts_log[-1]['error'] if attempts_log else 'Unknown error'}",
        "attempts": attempts_log
    }
