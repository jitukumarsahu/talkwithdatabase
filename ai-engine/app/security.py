import re
import json

def sanitize_sql(query: str) -> str:
    """Removes SQL comments and string literals to isolate executable statements."""
    # Remove single-line comments starting with --
    query = re.sub(r'--.*$', '', query, flags=re.MULTILINE)
    # Remove multi-line comments /* ... */
    query = re.sub(r'/\*.*?\*/', '', query, flags=re.DOTALL)
    # Remove single-quoted string literals, accounting for double single-quotes (escaping)
    query = re.sub(r"'(?:''|[^'])*'", "''", query)
    return query.strip()

def validate_sql_query(query: str) -> tuple[bool, str]:
    """
    Checks if a SQL query is strictly read-only.
    Blocks mutation statements (INSERT, UPDATE, DELETE, etc.) and ensures
    it starts with a SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN statement.
    """
    cleaned = sanitize_sql(query)
    if not cleaned:
        return False, "SQL query is empty"

    # Keywords that indicate mutations or administrative changes
    mutation_keywords = [
        r'\binsert\b', r'\bupdate\b', r'\bdelete\b', r'\bdrop\b', 
        r'\balter\b', r'\btruncate\b', r'\bcreate\b', r'\breplace\b', 
        r'\bgrant\b', r'\brevoke\b', r'\bmerge\b', r'\binto\b', 
        r'\bcopy\b', r'\bvacuum\b', r'\banalyze\b'
    ]

    for kw in mutation_keywords:
        if re.search(kw, cleaned, re.IGNORECASE):
            return False, f"Security Alert: Forbidden SQL mutation keyword detected matching pattern '{kw}'."

    # Validate that it starts with a read keyword
    # We split by whitespace or parenthesis (for queries like (SELECT ...))
    first_word_match = re.match(r'^\s*\(?\s*([a-zA-Z]+)', cleaned)
    if not first_word_match:
        return False, "Security Alert: Could not parse initial SQL keyword."
        
    first_word = first_word_match.group(1).upper()
    allowed_starts = {'SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'EXPLAIN'}
    if first_word not in allowed_starts:
        return False, f"Security Alert: SQL query must start with a read-only operation. Got: '{first_word}'."

    return True, ""

def validate_mongo_query(query_data) -> tuple[bool, str]:
    """
    Validates a MongoDB query representation for security.
    If query_data is a dictionary, inspects fields.
    If query_data is a string, validates it as a raw expression.
    """
    allowed_operations = {
        'find', 'find_one', 'count_documents', 
        'estimated_document_count', 'distinct', 'aggregate', 'db_stats'
    }

    if isinstance(query_data, dict):
        operation = query_data.get('operation', 'find').lower()
        if operation not in allowed_operations:
            return False, f"Security Alert: Forbidden MongoDB operation '{operation}'. Only read-only operations allowed."
        
        # If it's an aggregation, block $out and $merge stages
        if operation == 'aggregate':
            pipeline = query_data.get('pipeline', [])
            if not isinstance(pipeline, list):
                return False, "Security Alert: MongoDB 'pipeline' must be a list."
            
            # Stringify pipeline to perform a quick search for forbidden write stages
            pipeline_str = json.dumps(pipeline).lower()
            if '"$out"' in pipeline_str or '"$merge"' in pipeline_str:
                return False, "Security Alert: Aggregation pipeline contains write stages like $out or $merge."
        
        return True, ""
        
    elif isinstance(query_data, str):
        # Raw MongoDB query string verification (e.g. db.users.find(...))
        cleaned = query_data.strip().lower()
        
        # Mutation method checks
        forbidden_methods = [
            'insert', 'update', 'delete', 'replace', 'remove', 
            'drop', 'create', 'rename', 'save', 'bulkwrite'
        ]
        for method in forbidden_methods:
            if re.search(rf'\b{method}', cleaned):
                return False, f"Security Alert: Forbidden MongoDB method '{method}' detected in query string."
                
        # Aggregate write check
        if 'aggregate' in cleaned:
            if '$out' in cleaned or '$merge' in cleaned:
                return False, "Security Alert: Aggregation contains write stages ($out or $merge)."
                
        return True, ""
        
    return False, "Security Alert: Unsupported query data format for validation."
