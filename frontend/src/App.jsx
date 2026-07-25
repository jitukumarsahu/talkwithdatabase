import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  MessageSquare, 
  Settings, 
  Play, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Trash2, 
  Plus, 
  ChevronDown, 
  ChevronRight,
  RefreshCw, 
  Cpu, 
  Terminal, 
  Table,
  HelpCircle,
  Sparkles,
  Info,
  Layers,
  ArrowRight
} from 'lucide-react';

// Setup Mock Data for instant demo
const MOCK_SCHEMAS = {
  postgres: {
    db_type: "postgres",
    tables: [
      {
        name: "customers",
        schema: "public",
        columns: [
          { name: "customer_id", type: "integer", nullable: false },
          { name: "first_name", type: "character varying(50)", nullable: false },
          { name: "last_name", type: "character varying(50)", nullable: false },
          { name: "email", type: "character varying(100)", nullable: false },
          { name: "created_at", type: "timestamp without time zone", nullable: true }
        ]
      },
      {
        name: "orders",
        schema: "public",
        columns: [
          { name: "order_id", type: "integer", nullable: false },
          { name: "customer_id", type: "integer", nullable: false },
          { name: "order_date", type: "date", nullable: false },
          { name: "total_amount", type: "numeric(10,2)", nullable: false },
          { name: "status", type: "character varying(20)", nullable: false }
        ]
      },
      {
        name: "order_items",
        schema: "public",
        columns: [
          { name: "item_id", type: "integer", nullable: false },
          { name: "order_id", type: "integer", nullable: false },
          { name: "product_name", type: "character varying(100)", nullable: false },
          { name: "quantity", type: "integer", nullable: false },
          { name: "unit_price", type: "numeric(10,2)", nullable: false }
        ]
      }
    ],
    relations: [
      { from_table: "orders", from_column: "customer_id", to_table: "customers", to_column: "customer_id" },
      { from_table: "order_items", from_column: "order_id", to_table: "orders", to_column: "order_id" }
    ]
  },
  mongodb: {
    db_type: "mongodb",
    database_name: "ecommerce",
    collections: [
      {
        name: "users",
        sample_count: 5,
        fields: {
          "_id": { type: "ObjectId" },
          "name": { type: "String" },
          "email": { type: "String" },
          "shipping_address": { type: "Object", fields: ["street", "city", "zip", "country"] },
          "joined_date": { type: "datetime" }
        }
      },
      {
        name: "products",
        sample_count: 5,
        fields: {
          "_id": { type: "ObjectId" },
          "title": { type: "String" },
          "price": { type: "float" },
          "categories": { type: "Array of str" },
          "inventory": { type: "int" }
        }
      },
      {
        name: "orders",
        sample_count: 5,
        fields: {
          "_id": { type: "ObjectId" },
          "user_id": { type: "ObjectId" },
          "items": { type: "Array of Object" },
          "total_price": { type: "float" },
          "order_status": { type: "String" }
        }
      }
    ]
  }
};

const MOCK_CHAT_RESPONSE_SQL = {
  success: true,
  db_type: "postgres",
  query: "SELECT c.first_name, c.last_name, SUM(o.total_amount) as total_spent\nFROM customers c\nJOIN orders o ON c.customer_id = o.customer_id\nWHERE o.status = 'Completed'\nGROUP BY c.customer_id, c.first_name, c.last_name\nORDER BY total_spent DESC\nLIMIT 5;",
  explanation: "Joins customers and orders on customer_id, filters for 'Completed' orders, calculates total spending per customer using SUM, groups by customer, and sorts in descending order to fetch the top 5 spenders.",
  conversational_answer: "Based on the database results, here are our top 5 customers by order totals (excluding pending or cancelled orders):\n\n" +
    "1. **Sarah Connor** - $4,250.75\n" +
    "2. **John Connor** - $3,120.00\n" +
    "3. **Ellen Ripley** - $1,980.50\n" +
    "4. **Tony Stark** - $1,850.00\n" +
    "5. **Bruce Wayne** - $1,200.25\n\n" +
    "**Sarah Connor** is our highest-spending customer.",
  results: [
    { first_name: "Sarah", last_name: "Connor", total_spent: 4250.75 },
    { first_name: "John", last_name: "Connor", total_spent: 3120.00 },
    { first_name: "Ellen", last_name: "Ripley", total_spent: 1980.50 },
    { first_name: "Tony", last_name: "Stark", total_spent: 1850.00 },
    { first_name: "Bruce", last_name: "Wayne", total_spent: 1200.25 }
  ],
  attempts: [
    {
      attempt: 1,
      status: "failed",
      query: "SELECT customer_id, SUM(total_amount) FROM orders WHERE status = 'Completed' GROUP BY customer_id ORDER BY total_spent DESC",
      error: "psycopg2.errors.UndefinedColumn: column \"total_spent\" does not exist\nLINE 1: ...d ORDER BY total_spent DESC..."
    },
    {
      attempt: 2,
      status: "success",
      query: "SELECT c.first_name, c.last_name, SUM(o.total_amount) as total_spent\nFROM customers c\nJOIN orders o ON c.customer_id = o.customer_id\nWHERE o.status = 'Completed'\nGROUP BY c.customer_id, c.first_name, c.last_name\nORDER BY total_spent DESC\nLIMIT 5;",
      explanation: "Self-corrected the ORDER BY column reference syntax."
    }
  ]
};

const MOCK_CHAT_RESPONSE_MONGO = {
  success: true,
  db_type: "mongodb",
  query: {
    collection: "products",
    operation: "find",
    filter: { inventory: { "$lt": 10 } },
    projection: { title: 1, price: 1, inventory: 1 },
    sort: [["inventory", 1]],
    limit: 5
  },
  explanation: "Queries the 'products' collection filtering for items with inventory less than 10, projecting title, price, and inventory fields, sorting by inventory ascending, and limiting results to the top 5.",
  conversational_answer: "Here are the top 5 products with low inventory (less than 10 units):\n\n" +
    "- **Quantum Computing Keyboard** (Price: $189.99, Inventory: 2)\n" +
    "- **Wireless Trackball Mouse** (Price: $65.50, Inventory: 4)\n" +
    "- **Ergonomic Office Stool** (Price: $120.00, Inventory: 5)\n" +
    "- **4K Laser Projector** (Price: $899.00, Inventory: 8)\n" +
    "- **USB-C Portable Monitor** (Price: $150.00, Inventory: 9)\n\n" +
    "**Quantum Computing Keyboard** is running critical with only 2 units left.",
  results: [
    { _id: "60c72b2f9b1d8b2badc0f121", title: "Quantum Computing Keyboard", price: 189.99, inventory: 2 },
    { _id: "60c72b2f9b1d8b2badc0f122", title: "Wireless Trackball Mouse", price: 65.50, inventory: 4 },
    { _id: "60c72b2f9b1d8b2badc0f123", title: "Ergonomic Office Stool", price: 120.00, inventory: 5 },
    { _id: "60c72b2f9b1d8b2badc0f124", title: "4K Laser Projector", price: 899.00, inventory: 8 },
    { _id: "60c72b2f9b1d8b2badc0f125", title: "USB-C Portable Monitor", price: 150.00, inventory: 9 }
  ],
  attempts: [
    {
      attempt: 1,
      status: "failed",
      query: { collection: "products", operation: "update_many", filter: { inventory: { "$lt": 10 } } },
      error: "Security Alert: Forbidden MongoDB operation 'update_many'. Only read-only operations allowed."
    },
    {
      attempt: 2,
      status: "success",
      query: {
        collection: "products",
        operation: "find",
        filter: { inventory: { "$lt": 10 } },
        projection: { title: 1, price: 1, inventory: 1 },
        sort: [["inventory", 1]],
        limit: 5
      },
      explanation: "Self-corrected forbidden write operations to a safe read-only find operation."
    }
  ]
};

// Helper to render simple markdown bold formatting (e.g. **bold**) as inline tags
function renderFormattedContent(content) {
  if (!content) return null;
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-extrabold text-indigo-300 bg-indigo-950/40 px-1 py-0.5 rounded border border-indigo-500/20">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export default function App() {
  // Config & Gateway settings
  const [gatewayUrl, setGatewayUrl] = useState(() => localStorage.getItem('gateway_url') || 'http://localhost:5000');
  const [gatewayKey, setGatewayKey] = useState(() => localStorage.getItem('gateway_key') || 'dev-secret-key-123');
  const [showConfig, setShowConfig] = useState(false);

  // Server Gemini API Key Config states
  const [keyStatus, setKeyStatus] = useState('missing'); // 'configured' | 'invalid' | 'missing'
  const [maskedKey, setMaskedKey] = useState('None');
  const [keyError, setKeyError] = useState(null);
  const [newGeminiKey, setNewGeminiKey] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [actionStatus, setActionStatus] = useState({ type: '', message: '' });

  // Connection settings
  const [connections, setConnections] = useState(() => {
    const saved = localStorage.getItem('db_connections');
    return saved ? JSON.parse(saved) : [];
  });
  const [activeConnectionId, setActiveConnectionId] = useState(null);
  
  const [newConnName, setNewConnName] = useState('');
  const [newConnType, setNewConnType] = useState('postgres');
  const [newConnUri, setNewConnUri] = useState('');
  
  const [introspectLoading, setIntrospectLoading] = useState(false);
  const [introspectionError, setIntrospectionError] = useState(null);
  
  // App schemas
  const [dbSchemas, setDbSchemas] = useState({}); // { connId: schemaData }
  const [expandedTables, setExpandedTables] = useState({}); // { "connId-tableName": boolean }

  // Chat/Query state
  const [chats, setChats] = useState({}); // { connId: [messages] }
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [queryLoading, setQueryLoading] = useState(false);
  const [selectedResult, setSelectedResult] = useState(null); // Active message results to view in table
  const [showAttemptsLogId, setShowAttemptsLogId] = useState(null); // Msg ID showing self-heal details

  const messagesEndRef = useRef(null);

  // Save config values
  useEffect(() => {
    localStorage.setItem('gateway_url', gatewayUrl);
  }, [gatewayUrl]);

  useEffect(() => {
    localStorage.setItem('gateway_key', gatewayKey);
  }, [gatewayKey]);

  useEffect(() => {
    localStorage.setItem('db_connections', JSON.stringify(connections));
  }, [connections]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chats, activeConnectionId]);

  const fetchKeyStatus = async () => {
    try {
      const response = await fetch(`${gatewayUrl}/api/copilot/config/key/status`, {
        headers: {
          'x-api-key': gatewayKey
        }
      });
      if (response.ok) {
        const data = await response.json();
        setKeyStatus(data.status);
        setMaskedKey(data.masked_key);
        setKeyError(data.error_message);
      }
    } catch (err) {
      console.error("Failed to fetch Gemini key status", err);
    }
  };

  useEffect(() => {
    if (showConfig) {
      setActionStatus({ type: '', message: '' });
      fetchKeyStatus();
    }
  }, [showConfig, gatewayUrl, gatewayKey]);

  const handleTestKey = async () => {
    if (!newGeminiKey.trim()) return;
    setTestLoading(true);
    setActionStatus({ type: '', message: '' });
    try {
      const response = await fetch(`${gatewayUrl}/api/copilot/config/key/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': gatewayKey
        },
        body: JSON.stringify({ gemini_api_key: newGeminiKey })
      });
      const data = await response.json();
      if (response.ok && data.valid) {
        setActionStatus({ type: 'success', message: 'Verification successful! This is a valid Gemini key.' });
      } else {
        setActionStatus({ type: 'error', message: `Verification failed: ${data.message || 'Invalid key.'}` });
      }
    } catch (err) {
      setActionStatus({ type: 'error', message: `Network error: ${err.message}` });
    } finally {
      setTestLoading(false);
    }
  };

  const handleSaveKey = async () => {
    if (!newGeminiKey.trim()) return;
    setSaveLoading(true);
    setActionStatus({ type: '', message: '' });
    try {
      const response = await fetch(`${gatewayUrl}/api/copilot/config/key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': gatewayKey
        },
        body: JSON.stringify({ gemini_api_key: newGeminiKey })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        if (data.valid) {
          setActionStatus({ type: 'success', message: 'API Key saved and verified successfully.' });
        } else {
          setActionStatus({ type: 'warning', message: `API Key saved, but verification failed: ${data.error || 'Invalid key'}` });
        }
        setNewGeminiKey('');
        fetchKeyStatus();
      } else {
        setActionStatus({ type: 'error', message: `Failed to save key: ${data.message || 'Unknown error'}` });
      }
    } catch (err) {
      setActionStatus({ type: 'error', message: `Network error: ${err.message}` });
    } finally {
      setSaveLoading(false);
    }
  };

  const handleClearKey = async () => {
    if (!window.confirm("Are you sure you want to clear the server's Gemini API Key?")) return;
    setActionStatus({ type: '', message: '' });
    try {
      const response = await fetch(`${gatewayUrl}/api/copilot/config/key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': gatewayKey
        },
        body: JSON.stringify({ gemini_api_key: '' })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setActionStatus({ type: 'success', message: 'Gemini API Key cleared successfully.' });
        setNewGeminiKey('');
        fetchKeyStatus();
      } else {
        setActionStatus({ type: 'error', message: `Failed to clear key: ${data.message || 'Unknown error'}` });
      }
    } catch (err) {
      setActionStatus({ type: 'error', message: `Network error: ${err.message}` });
    }
  };

  const activeConnection = connections.find(c => c.id === activeConnectionId);
  const activeSchema = activeConnection ? dbSchemas[activeConnection.id] : null;
  const activeChat = activeConnection ? (chats[activeConnection.id] || []) : [];

  const handleAddConnection = async (e) => {
    e.preventDefault();
    if (!newConnName || !newConnUri) return;

    const id = Date.now().toString();
    const isMock = newConnUri.toLowerCase().trim() === 'mock';
    
    const newConn = {
      id,
      name: newConnName,
      type: newConnType,
      connectionString: newConnUri,
      isMock,
      status: 'disconnected'
    };

    setConnections(prev => [...prev, newConn]);
    setNewConnName('');
    setNewConnUri('');
    
    // Auto-select connection
    handleConnect(newConn);
  };

  const handleConnect = async (conn) => {
    setIntrospectLoading(true);
    setIntrospectionError(null);
    setActiveConnectionId(conn.id);

    // If it's a mock database, load mock structures instantly
    if (conn.isMock) {
      setTimeout(() => {
        const mockSchema = MOCK_SCHEMAS[conn.type];
        setDbSchemas(prev => ({ ...prev, [conn.id]: mockSchema }));
        setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, status: 'connected' } : c));
        setIntrospectLoading(false);
      }, 800);
      return;
    }

    try {
      const response = await fetch(`${gatewayUrl}/api/copilot/introspect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': gatewayKey
        },
        body: JSON.stringify({
          db_type: conn.type,
          connection_string: conn.connectionString
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.detail || data.message || 'Introspection request failed');
      }

      setDbSchemas(prev => ({ ...prev, [conn.id]: data }));
      setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, status: 'connected' } : c));
    } catch (err) {
      console.error(err);
      setIntrospectionError(err.message);
      setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, status: 'error' } : c));
    } finally {
      setIntrospectLoading(false);
    }
  };

  const handleDeleteConnection = (id, e) => {
    e.stopPropagation();
    setConnections(prev => prev.filter(c => c.id !== id));
    if (activeConnectionId === id) {
      setActiveConnectionId(null);
    }
  };

  const handleDemoMode = () => {
    // Inject two mock connections if empty
    const pgId = 'demo-postgres';
    const mgId = 'demo-mongodb';
    
    const mockPg = {
      id: pgId,
      name: 'Demo PostgreSQL (Mock)',
      type: 'postgres',
      connectionString: 'mock',
      isMock: true,
      status: 'connected'
    };

    const mockMg = {
      id: mgId,
      name: 'Demo MongoDB (Mock)',
      type: 'mongodb',
      connectionString: 'mock',
      isMock: true,
      status: 'connected'
    };

    setConnections([mockPg, mockMg]);
    setDbSchemas({
      [pgId]: MOCK_SCHEMAS.postgres,
      [mgId]: MOCK_SCHEMAS.mongodb
    });
    setActiveConnectionId(pgId);
    
    // Inject introductory messages
    setChats({
      [pgId]: [
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Hello! I have connected to your PostgreSQL database. Go ahead and ask me questions about your tables, e.g., "Who are our top 5 customers by order totals?"',
          timestamp: new Date().toISOString()
        }
      ],
      [mgId]: [
        {
          id: 'welcome',
          role: 'assistant',
          content: 'Hi! I am connected to ecommerce MongoDB collection schema. Ask me questions, e.g., "Find products with low inventory less than 10"',
          timestamp: new Date().toISOString()
        }
      ]
    });
  };

  const toggleTable = (tableKey) => {
    setExpandedTables(prev => ({ ...prev, [tableKey]: !prev[tableKey] }));
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!currentPrompt.trim() || !activeConnection || introspectLoading || queryLoading) return;

    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      content: currentPrompt,
      timestamp: new Date().toISOString()
    };

    // Append user message
    setChats(prev => ({
      ...prev,
      [activeConnection.id]: [...(prev[activeConnection.id] || []), userMsg]
    }));

    const questionText = currentPrompt;
    setCurrentPrompt('');
    setQueryLoading(true);

    // If active connection is a mock, resolve mock results after a short delay
    if (activeConnection.isMock) {
      setTimeout(() => {
        const isPg = activeConnection.type === 'postgres';
        const mockResult = isPg ? MOCK_CHAT_RESPONSE_SQL : MOCK_CHAT_RESPONSE_MONGO;
        
        const assistMsg = {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: mockResult.conversational_answer || `Here are the results matching your query for "${questionText}".`,
          query: mockResult.query,
          explanation: mockResult.explanation,
          results: mockResult.results,
          attempts: mockResult.attempts,
          success: mockResult.success,
          timestamp: new Date().toISOString()
        };
        
        setChats(prev => ({
          ...prev,
          [activeConnection.id]: [...(prev[activeConnection.id] || []), assistMsg]
        }));
        setQueryLoading(false);
      }, 1500);
      return;
    }

    // Prepare conversation history context (excluding welcome msg, sending last 6 messages)
    const history = activeChat
      .filter(msg => msg.id !== 'welcome')
      .slice(-6)
      .map(msg => {
        let content = msg.content;
        if (msg.role === 'assistant' && msg.success) {
          if (msg.results) {
            content += `\n[Database Results: ${JSON.stringify(msg.results)}]`;
          }
          if (msg.query) {
            content += `\n[Executed Query: ${typeof msg.query === 'string' ? msg.query : JSON.stringify(msg.query)}]`;
          }
        }
        return {
          role: msg.role,
          content: content
        };
      });

    try {
      const response = await fetch(`${gatewayUrl}/api/copilot/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': gatewayKey
        },
        body: JSON.stringify({
          db_type: activeConnection.type,
          connection_string: activeConnection.connectionString,
          schema_context: activeSchema,
          question: questionText,
          history: history
        })
      });

      let data = {};
      try {
        data = await response.json();
      } catch (jsonErr) {
        console.error("Failed to parse response JSON", jsonErr);
      }

      if (!response.ok) {
        const errorDetail = data.detail || data.message || data.error || `HTTP Error ${response.status}: ${response.statusText}`;
        const assistMsg = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `AI Engine Error: ${errorDetail}`,
          success: false,
          timestamp: new Date().toISOString()
        };
        setChats(prev => ({
          ...prev,
          [activeConnection.id]: [...(prev[activeConnection.id] || []), assistMsg]
        }));
        return;
      }
      
      const assistMsg = {
        id: Date.now().toString(),
        role: 'assistant',
        content: data.success 
          ? (data.conversational_answer || `I've successfully generated and executed the query.`)
          : (data.conversational_answer || `Failed to answer your question after 3 self-healing attempts.`),
        query: data.query,
        explanation: data.explanation || data.error || 'Check self-healing logs.',
        results: data.results || null,
        attempts: data.attempts || [],
        success: data.success,
        timestamp: new Date().toISOString()
      };

      setChats(prev => ({
        ...prev,
        [activeConnection.id]: [...(prev[activeConnection.id] || []), assistMsg]
      }));

      // No automatic selectedResult setting to keep the grid hidden by default
    } catch (err) {
      console.error(err);
      const errorMsg = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Error occurred while reaching the gateway: ${err.message}`,
        success: false,
        timestamp: new Date().toISOString()
      };
      setChats(prev => ({
        ...prev,
        [activeConnection.id]: [...(prev[activeConnection.id] || []), errorMsg]
      }));
    } finally {
      setQueryLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0f172a] text-slate-100 font-sans antialiased overflow-hidden">
      {/* Top Header */}
      <header className="flex justify-between items-center px-6 py-4 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
            <Cpu className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
              Dynamic DB Copilot
            </h1>
            <p className="text-xs text-slate-400 font-medium flex items-center">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-ping"></span>
              Multi-Service AI Engine
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <button 
            onClick={handleDemoMode}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500/10 to-yellow-500/10 hover:from-amber-500/20 hover:to-yellow-500/20 border border-amber-500/30 text-amber-300 font-medium rounded-lg text-xs transition duration-200"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Try Demo Mode</span>
          </button>
          
          <button 
            onClick={() => setShowConfig(!showConfig)}
            className={`p-2 rounded-lg transition duration-200 border ${
              showConfig 
                ? 'bg-indigo-600 border-indigo-500 text-white' 
                : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
            }`}
            title="Gateway API Configuration"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Settings Modal Bar */}
        {showConfig && (
          <div className="absolute top-0 right-0 left-0 bg-slate-900 border-b border-slate-805 px-6 py-5 z-30 shadow-2xl animate-in slide-in-from-top duration-200">
            <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Column 1: Local Gateway Connection */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-305 uppercase tracking-wider border-b border-slate-800 pb-2 flex items-center">
                  <Settings className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                  API Gateway Settings (Local)
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Gateway Endpoint</label>
                    <input 
                      type="text" 
                      value={gatewayUrl} 
                      onChange={(e) => setGatewayUrl(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-indigo-500 focus:outline-none"
                      placeholder="http://localhost:5000"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Gateway Auth Key (x-api-key)</label>
                    <input 
                      type="password" 
                      value={gatewayKey} 
                      onChange={(e) => setGatewayKey(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-indigo-500 focus:outline-none"
                      placeholder="secret-key"
                    />
                  </div>
                </div>
              </div>

              {/* Column 2: Server Gemini API Key Connection */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-slate-305 uppercase tracking-wider border-b border-slate-800 pb-2 flex items-center justify-between">
                  <span className="flex items-center">
                    <Cpu className="w-3.5 h-3.5 mr-1.5 text-purple-400" />
                    Gemini API Key (Server Config)
                  </span>
                  {/* Status Badge */}
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                    keyStatus === 'configured' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                    keyStatus === 'invalid' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                    'bg-slate-800 text-slate-400 border-slate-700'
                  }`}>
                    {keyStatus === 'configured' ? 'Active' : keyStatus === 'invalid' ? 'Invalid/Expired' : 'Not Set'}
                  </span>
                </h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Masked Key: <span className="font-mono text-slate-300 font-normal">{maskedKey}</span>
                      </label>
                      {keyError && (
                        <span className="text-[10px] text-rose-400 italic font-medium truncate max-w-[200px]" title={keyError}>
                          {keyError}
                        </span>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      <input 
                        type="password" 
                        value={newGeminiKey} 
                        onChange={(e) => setNewGeminiKey(e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:border-indigo-500 focus:outline-none"
                        placeholder="Enter new Gemini API Key..."
                      />
                      <button 
                        onClick={handleTestKey}
                        disabled={testLoading || !newGeminiKey.trim()}
                        className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 font-semibold rounded-lg text-xs transition duration-200"
                      >
                        {testLoading ? 'Testing...' : 'Test'}
                      </button>
                    </div>
                  </div>

                  {/* Status/Warning Log banner */}
                  {actionStatus.message && (
                    <div className={`p-2.5 rounded-lg border text-[11px] font-medium flex items-center space-x-2 ${
                      actionStatus.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' :
                      actionStatus.type === 'warning' ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' :
                      'bg-rose-500/10 border-rose-500/20 text-rose-305'
                    }`}>
                      <span>{actionStatus.message}</span>
                    </div>
                  )}

                  <div className="flex justify-end space-x-2">
                    {keyStatus !== 'missing' && (
                      <button 
                        onClick={handleClearKey}
                        className="px-3.5 py-1.5 bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/20 text-rose-400 font-semibold rounded-lg text-xs transition duration-200"
                      >
                        Clear Key
                      </button>
                    )}
                    <button 
                      onClick={handleSaveKey}
                      disabled={saveLoading || !newGeminiKey.trim()}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg text-xs transition duration-200"
                    >
                      {saveLoading ? 'Saving...' : 'Save & Apply'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="max-w-6xl mx-auto flex justify-end mt-4 pt-3 border-t border-slate-800/60">
              <button 
                onClick={() => setShowConfig(false)}
                className="bg-indigo-600 hover:bg-indigo-500 px-5 py-1.5 rounded-lg text-xs font-semibold text-white transition duration-200"
              >
                Close Settings
              </button>
            </div>
          </div>
        )}

        {/* Sidebar Panel: Databases & Schemas */}
        <aside className="w-80 bg-slate-900/60 border-r border-slate-800/80 flex flex-col shrink-0 overflow-y-auto">
          {/* Section: Add Connection */}
          <div className="p-4 border-b border-slate-800/80">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center">
              <Database className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
              Add Connection
            </h2>
            <form onSubmit={handleAddConnection} className="space-y-3">
              <div>
                <input 
                  type="text"
                  placeholder="Connection name (e.g. Sales DB)"
                  value={newConnName}
                  onChange={(e) => setNewConnName(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition"
                  required
                />
              </div>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setNewConnType('postgres')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition ${
                    newConnType === 'postgres'
                      ? 'bg-indigo-600/10 border-indigo-500 text-indigo-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Postgres
                </button>
                <button
                  type="button"
                  onClick={() => setNewConnType('mongodb')}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition ${
                    newConnType === 'mongodb'
                      ? 'bg-indigo-600/10 border-indigo-500 text-indigo-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  MongoDB
                </button>
              </div>
              <div className="relative">
                <input 
                  type="text"
                  placeholder="URI String (or type 'mock' for Demo)"
                  value={newConnUri}
                  onChange={(e) => setNewConnUri(e.target.value)}
                  className="w-full bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono placeholder-slate-500 focus:border-indigo-500 focus:outline-none transition pr-8"
                  required
                />
                <div className="absolute right-2.5 top-2.5 group cursor-help">
                  <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300" />
                  <span className="absolute bottom-full right-0 w-48 hidden group-hover:block bg-slate-900 border border-slate-700 text-slate-300 text-[10px] p-2 rounded shadow-xl z-50">
                    Use full URI format: <br/>
                    - Postgres: postgresql://user:pass@host:port/db <br/>
                    - MongoDB: mongodb+srv://user:pass@cluster.net/db <br/>
                    - Or type 'mock' to run locally.
                  </span>
                </div>
              </div>
              <button
                type="submit"
                className="w-full flex items-center justify-center space-x-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition duration-200 hover:shadow-lg hover:shadow-indigo-500/10"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect Database</span>
              </button>
            </form>
          </div>

          {/* Section: Connections List */}
          <div className="p-4 border-b border-slate-800/80">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              My Databases
            </h2>
            {connections.length === 0 ? (
              <div className="text-center py-6 text-slate-500 border border-dashed border-slate-800 rounded-xl">
                <Database className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                <p className="text-[11px]">No active database connections.</p>
                <button 
                  onClick={handleDemoMode}
                  className="text-xs text-indigo-400 font-semibold mt-1.5 hover:underline"
                >
                  Quick Setup Demo
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {connections.map((conn) => {
                  const isActive = conn.id === activeConnectionId;
                  return (
                    <div 
                      key={conn.id}
                      onClick={() => handleConnect(conn)}
                      className={`group flex justify-between items-center p-2.5 rounded-lg border cursor-pointer transition ${
                        isActive
                          ? 'bg-slate-800 border-indigo-500/50 shadow-md'
                          : 'bg-slate-950/40 border-slate-800 hover:bg-slate-800/30'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 overflow-hidden">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          conn.status === 'connected' ? 'bg-emerald-500' :
                          conn.status === 'error' ? 'bg-rose-500' : 'bg-slate-600'
                        }`} />
                        <div className="overflow-hidden">
                          <p className="text-xs font-semibold truncate text-slate-200">{conn.name}</p>
                          <p className="text-[10px] text-slate-500 truncate font-mono">{conn.type.toUpperCase()}</p>
                        </div>
                      </div>
                      <button 
                        onClick={(e) => handleDeleteConnection(conn.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-400 rounded transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section: Schema Explorer */}
          <div className="flex-1 p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center">
                <Layers className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                Schema Explorer
              </h2>
              {activeConnection && activeConnection.status === 'connected' && (
                <button 
                  onClick={() => handleConnect(activeConnection)} 
                  className="p-1 hover:bg-slate-800 rounded transition text-slate-400 hover:text-slate-200"
                  title="Reload Schema"
                >
                  <RefreshCw className={`w-3 h-3 ${introspectLoading ? 'animate-spin' : ''}`} />
                </button>
              )}
            </div>

            {introspectLoading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <RefreshCw className="w-6 h-6 animate-spin mb-2 text-indigo-400" />
                <p className="text-xs">Analyzing tables & schema...</p>
              </div>
            ) : introspectionError ? (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 rounded-lg text-[11px] flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{introspectionError}</span>
              </div>
            ) : !activeConnection ? (
              <p className="text-xs text-slate-500 text-center py-6 italic">Select or connect a database above to view structure.</p>
            ) : activeSchema ? (
              <div className="space-y-2">
                {/* Postgres Schema layout */}
                {activeSchema.db_type === 'postgres' && activeSchema.tables && (
                  <div className="space-y-1.5">
                    {activeSchema.tables.map(table => {
                      const tableKey = `${activeConnection.id}-${table.name}`;
                      const isExpanded = !!expandedTables[tableKey];
                      return (
                        <div key={table.name} className="border border-slate-800/80 rounded-lg bg-slate-950/20 overflow-hidden">
                          <button
                            onClick={() => toggleTable(tableKey)}
                            className="w-full flex items-center justify-between p-2 hover:bg-slate-800/40 transition text-left"
                          >
                            <div className="flex items-center space-x-2">
                              <Table className="w-3.5 h-3.5 text-indigo-400" />
                              <span className="text-xs font-semibold text-slate-300">{table.name}</span>
                            </div>
                            {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-2 border-t border-slate-900 bg-slate-950/40 text-[10px] divide-y divide-slate-900/60">
                              {table.columns.map(col => (
                                <div key={col.name} className="flex justify-between py-1.5">
                                  <span className="font-mono text-slate-400">{col.name}</span>
                                  <span className="text-slate-500 italic">{col.type}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* MongoDB Schema layout */}
                {activeSchema.db_type === 'mongodb' && activeSchema.collections && (
                  <div className="space-y-1.5">
                    {activeSchema.collections.map(col => {
                      const colKey = `${activeConnection.id}-${col.name}`;
                      const isExpanded = !!expandedTables[colKey];
                      return (
                        <div key={col.name} className="border border-slate-800/80 rounded-lg bg-slate-950/20 overflow-hidden">
                          <button
                            onClick={() => toggleTable(colKey)}
                            className="w-full flex items-center justify-between p-2 hover:bg-slate-800/40 transition text-left"
                          >
                            <div className="flex items-center space-x-2">
                              <Layers className="w-3.5 h-3.5 text-purple-400" />
                              <span className="text-xs font-semibold text-slate-300">{col.name}</span>
                            </div>
                            {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-2 border-t border-slate-900 bg-slate-950/40 text-[10px] divide-y divide-slate-900/60">
                              {Object.entries(col.fields).map(([fieldName, fieldData]) => (
                                <div key={fieldName} className="flex justify-between py-1.5">
                                  <span className="font-mono text-slate-400">{fieldName}</span>
                                  <span className="text-purple-400 italic">
                                    {fieldData.type}
                                    {fieldData.fields && ` [keys: ${fieldData.fields.slice(0, 3).join(', ')}]`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic text-center py-6">Connecting database...</p>
            )}
          </div>
        </aside>

        {/* Central Area: Chat & Execution Results */}
        <main className="flex-1 flex flex-col min-w-0 bg-slate-950">
          
          {/* Active DB Context Header */}
          <div className="bg-slate-900/50 border-b border-slate-800/50 px-6 py-3 shrink-0 flex items-center justify-between">
            <div className="flex items-center space-x-2.5">
              <Database className="w-4 h-4 text-indigo-400" />
              <div className="text-xs">
                <span className="text-slate-400">Database Connection: </span>
                <span className="font-bold text-slate-200">
                  {activeConnection ? activeConnection.name : 'None Selected'}
                </span>
                {activeConnection && (
                  <span className="ml-2 font-mono px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-400 border border-slate-700">
                    {activeConnection.type.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
            
            {activeConnection && (
              <div className="flex items-center space-x-4">
                {activeChat.length > 1 && (
                  <button
                    onClick={() => {
                      setChats(prev => ({
                        ...prev,
                        [activeConnection.id]: activeChat.slice(0, 1)
                      }));
                      setSelectedResult(null);
                    }}
                    className="flex items-center space-x-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-rose-200 border border-slate-700/60 rounded-lg text-[10px] font-semibold transition"
                    title="Clear Memory & Chat History"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>Clear Chat</span>
                  </button>
                )}
                <div className="flex items-center space-x-1">
                  <div className={`w-1.5 h-1.5 rounded-full ${activeConnection.status === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="text-[10px] text-slate-400 font-medium capitalize">{activeConnection.status}</span>
                </div>
              </div>
            )}
          </div>

          {/* Chat Pane */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
            {activeChat.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
                  <MessageSquare className="w-6 h-6 animate-bounce" />
                </div>
                <h3 className="font-bold text-slate-200 text-md">AI Query Assistant</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Provide database connection parameters and start asking questions in natural language.
                  The AI Copilot will inspect schemas, formulate read-only queries, test them, and heal syntax errors automatically.
                </p>
                
                {!activeConnection && (
                  <button 
                    onClick={handleDemoMode}
                    className="flex items-center space-x-1.5 px-4 py-2 mt-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition duration-200"
                  >
                    <span>Load Demo Workspace</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              activeChat.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-3xl rounded-2xl p-4 border transition duration-200 ${
                      isUser 
                        ? 'bg-indigo-600 border-indigo-500 text-white rounded-br-none' 
                        : 'bg-slate-900 border-slate-800 text-slate-200 rounded-bl-none shadow-md'
                    }`}>
                      {/* Message Content */}
                      <p className="text-xs whitespace-pre-wrap leading-relaxed">
                        {renderFormattedContent(msg.content)}
                      </p>

                      {/* Assistant query breakdown */}
                      {!isUser && msg.query && (
                        <div className="mt-3.5 space-y-3.5 border-t border-slate-800/80 pt-3">
                          {/* Query text */}
                          <div>
                            <div className="flex justify-between items-center mb-1 text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                              <span className="flex items-center">
                                <Terminal className="w-3.5 h-3.5 mr-1 text-slate-400" />
                                Generated {activeConnection?.type === 'postgres' ? 'SQL Query' : 'MQL Payload'}
                              </span>
                              <button
                                onClick={() => {
                                  const queryText = typeof msg.query === 'string' ? msg.query : JSON.stringify(msg.query, null, 2);
                                  navigator.clipboard.writeText(queryText);
                                }}
                                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[9px] font-semibold transition"
                                title="Copy query to clipboard"
                              >
                                Copy
                              </button>
                            </div>
                            <pre className="p-3 bg-slate-950 border border-slate-850 rounded-xl font-mono text-[11px] text-emerald-400 overflow-x-auto whitespace-pre-wrap leading-5">
                              {typeof msg.query === 'string' ? msg.query : JSON.stringify(msg.query, null, 2)}
                            </pre>
                          </div>

                          {/* Explanation */}
                          {msg.explanation && (
                            <div className="text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/30 flex items-start space-x-2">
                              <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                              <p className="text-slate-400 leading-normal text-[11px]"><span className="font-semibold text-slate-300">Explanation:</span> {msg.explanation}</p>
                            </div>
                          )}

                          {/* Self Healing Logs triggers */}
                          {msg.attempts && msg.attempts.length > 0 && (
                            <div className="border border-slate-850 rounded-xl overflow-hidden bg-slate-950/20">
                              <button 
                                onClick={() => setShowAttemptsLogId(showAttemptsLogId === msg.id ? null : msg.id)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-slate-950/40 text-[10px] text-slate-400 font-bold hover:bg-slate-900/60 transition"
                              >
                                <span className="flex items-center text-indigo-300">
                                  <Cpu className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
                                  Gemini Self-Healing Timeline ({msg.attempts.length} attempts)
                                </span>
                                {showAttemptsLogId === msg.id ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                              
                              {showAttemptsLogId === msg.id && (
                                <div className="p-3 bg-slate-950/60 border-t border-slate-900 space-y-3">
                                  {msg.attempts.map((att, idx) => (
                                    <div key={idx} className="relative pl-5 border-l border-slate-800 pb-1.5 last:pb-0">
                                      <div className={`absolute -left-1.5 top-1.5 w-3 h-3 rounded-full border border-slate-950 ${
                                        att.status === 'success' ? 'bg-emerald-500' : 'bg-rose-500'
                                      }`} />
                                      <p className="text-[10px] font-bold text-slate-300">Attempt {att.attempt}: {att.status.toUpperCase()}</p>
                                      
                                      <div className="mt-1 font-mono text-[9px] text-slate-400 break-all p-1.5 bg-slate-950 border border-slate-900 rounded">
                                        {typeof att.query === 'string' ? att.query : JSON.stringify(att.query)}
                                      </div>
                                      
                                      {att.error && (
                                        <p className="text-[9px] text-rose-400 font-mono mt-1 bg-rose-500/5 p-1.5 border border-rose-500/10 rounded">
                                          Error: {att.error}
                                        </p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Action button */}
                          {msg.results && (
                            <div className="flex justify-end">
                              <button 
                                onClick={() => setSelectedResult(msg)}
                                className={`flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${
                                  selectedResult?.id === msg.id
                                    ? 'bg-emerald-600/10 border-emerald-500/40 text-emerald-300'
                                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                                }`}
                              >
                                <Table className="w-3.5 h-3.5" />
                                <span>{selectedResult?.id === msg.id ? 'Viewing Results' : 'View Results Grid'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            {queryLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 rounded-bl-none shadow-md flex items-center space-x-3.5 text-xs text-slate-400">
                  <div className="relative">
                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    <Cpu className="w-3.5 h-3.5 text-indigo-400 absolute top-1.25 left-1.25 animate-pulse" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-semibold text-slate-300">Gemini AI Thinking...</p>
                    <p className="text-[10px] text-slate-500">Checking safety guardrails & running self-healer loop</p>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Results Grid Tab (Displays table if selected) */}
          {selectedResult && selectedResult.results && (
            <div className="h-64 bg-slate-900 border-t border-slate-800 flex flex-col shrink-0 overflow-hidden relative shadow-inner animate-in slide-in-from-bottom duration-200">
              <div className="flex justify-between items-center px-4 py-2 border-b border-slate-800 bg-slate-950 shrink-0">
                <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center">
                  <Table className="w-4 h-4 mr-1.5" />
                  Database Results Grid ({selectedResult.results.length} rows returned)
                </h4>
                <div className="flex items-center space-x-2">
                  {selectedResult.results.length > 0 && (
                    <>
                      <button
                        onClick={() => {
                          const results = selectedResult.results;
                          const headers = Object.keys(results[0]).join(',');
                          const rows = results.map(row => 
                            Object.values(row).map(val => {
                              const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
                              return `"${str.replace(/"/g, '""')}"`;
                            }).join(',')
                          );
                          const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join('\n');
                          const encodedUri = encodeURI(csvContent);
                          const link = document.createElement("a");
                          link.setAttribute("href", encodedUri);
                          link.setAttribute("download", `query_results_${Date.now()}.csv`);
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-350 hover:text-white rounded text-[10px] font-semibold transition"
                      >
                        Export CSV
                      </button>
                      <button
                        onClick={() => {
                          const resultsStr = JSON.stringify(selectedResult.results, null, 2);
                          const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(resultsStr);
                          const link = document.createElement("a");
                          link.setAttribute("href", dataUri);
                          link.setAttribute("download", `query_results_${Date.now()}.json`);
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-350 hover:text-white rounded text-[10px] font-semibold transition"
                      >
                        Export JSON
                      </button>
                    </>
                  )}
                  <button 
                    onClick={() => setSelectedResult(null)}
                    className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition text-xs font-bold"
                  >
                    Close Grid
                  </button>
                </div>
              </div>

              {/* Data Table */}
              <div className="flex-1 overflow-auto p-4">
                {selectedResult.results.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-12 italic">Empty dataset returned.</p>
                ) : (
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950 border-b border-slate-850">
                        {Object.keys(selectedResult.results[0]).map((key) => (
                          <th key={key} className="px-3 py-2 font-mono font-bold text-slate-300 select-all">{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-850">
                      {selectedResult.results.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-850/40 transition">
                          {Object.values(row).map((val, cellIdx) => (
                            <td key={cellIdx} className="px-3 py-2 text-slate-400 font-mono truncate max-w-xs" title={String(val)}>
                              {val === null ? <span className="text-slate-600 font-sans italic">null</span> : 
                               typeof val === 'object' ? JSON.stringify(val) : String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Prompt Entry Box */}
          <div className="p-4 bg-slate-900 border-t border-slate-800 shrink-0">
            <form onSubmit={handleSendMessage} className="relative flex items-center">
              <input 
                type="text" 
                placeholder={
                  !activeConnection 
                    ? "Please connect a database to begin query generation..." 
                    : activeConnection.status !== 'connected'
                    ? "Connecting database schema..."
                    : `Ask "${activeConnection.name}" a question in plain English...`
                }
                value={currentPrompt}
                onChange={(e) => setCurrentPrompt(e.target.value)}
                disabled={!activeConnection || activeConnection.status !== 'connected' || queryLoading}
                className="w-full bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl pl-4 pr-16 py-3 text-xs text-slate-200 focus:outline-none transition leading-normal disabled:opacity-50"
              />
              <div className="absolute right-2.5 flex items-center space-x-1">
                <button
                  type="submit"
                  disabled={!activeConnection || activeConnection.status !== 'connected' || !currentPrompt.trim() || queryLoading}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg p-2 transition font-bold"
                >
                  <Play className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>

        </main>
      </div>
    </div>
  );
}
