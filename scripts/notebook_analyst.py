#!/usr/bin/env python3
"""
An interactive AI Data Analyst that connects to your Supabase database, powered by a local LLM.

This script allows you to ask natural language questions about your SEO and
traffic data. It uses a local LLM (via Ollama) to convert your question into a SQL query,
executes it against your database, and then uses Ollama again to provide
a clear, human-readable answer.
"""

import os
import pandas as pd
from sqlalchemy import create_engine, text
import ollama

# --- Configuration & Setup ---

def get_db_engine():
    """Creates and returns a SQLAlchemy engine for the Supabase DB."""
    # The DB URL format is in your BI-APP-BUILD-PROMPT.md doc.
    # Make sure to use your actual database password from the Supabase dashboard.
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        raise ValueError("SUPABASE_DB_URL environment variable is not set. Please provide your full Supabase Postgres connection string.")
    return create_engine(db_url)

def check_ollama_connection():
    """Checks if the Ollama server is running and a model is available."""
    try:
        ollama.list()
        print("✅ Ollama connection successful.")
    except Exception:
        raise ConnectionError("Could not connect to Ollama. Please ensure Ollama is running. \n"
                              "You can download it from https://ollama.com and then run 'ollama run llama3:8b' to get started.")

def get_database_schema():
    """
    Returns the database schema as a string.
    In a real application, you might fetch this dynamically. For now, we'll use the
    schema defined in your project documentation (BI-APP-BUILD-PROMPT.md).
    """
    return """
-- This schema is a subset of the full schema in BI-APP-BUILD-PROMPT.md,
-- focusing on the tables populated by the sync_data.py script.

CREATE TABLE IF NOT EXISTS gsc_daily (
  id            bigserial PRIMARY KEY,
  site          text NOT NULL,
  date          date NOT NULL,
  clicks        integer NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  avg_ctr       numeric(5,2) NOT NULL DEFAULT 0,
  avg_position  numeric(5,1) NOT NULL DEFAULT 0,
  UNIQUE (site, date)
);

CREATE TABLE IF NOT EXISTS gsc_keywords (
  id            bigserial PRIMARY KEY,
  site          text NOT NULL,
  snapshot_date date NOT NULL,
  keyword       text NOT NULL,
  clicks        integer NOT NULL DEFAULT 0,
  impressions   integer NOT NULL DEFAULT 0,
  avg_ctr       numeric(5,2) NOT NULL DEFAULT 0,
  avg_position  numeric(5,1) NOT NULL DEFAULT 0,
  UNIQUE (site, snapshot_date, keyword)
);

CREATE TABLE IF NOT EXISTS ga4_daily (
  id                    bigserial PRIMARY KEY,
  site                  text NOT NULL,
  date                  date NOT NULL,
  sessions              integer NOT NULL DEFAULT 0,
  users                 integer NOT NULL DEFAULT 0,
  new_users             integer NOT NULL DEFAULT 0,
  purchases             integer NOT NULL DEFAULT 0,
  revenue               numeric(12,2) NOT NULL DEFAULT 0,
  UNIQUE (site, date)
);

CREATE TABLE IF NOT EXISTS content_signals (
  id                  bigserial PRIMARY KEY,
  site                text NOT NULL,
  page                text NOT NULL,
  avg_position_7d     numeric(5,1),
  avg_position_30d    numeric(5,1),
  opportunity_score   numeric(5,2),
  UNIQUE (site, page)
);

CREATE TABLE IF NOT EXISTS sync_log (
  id            bigserial PRIMARY KEY,
  run_id        uuid NOT NULL,
  site          text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  rows_written  integer NOT NULL DEFAULT 0,
  status        text NOT NULL,
  error_msg     text
);
    """

# --- Core Analyst Functions ---

def generate_sql_from_question(question: str, schema: str) -> str:
    """Uses a local Ollama model to generate a SQL query from a natural language question."""
    print("🧠 Step 1: Generating SQL from your question (using local LLM)...")
    
    prompt = f"""
You are an expert PostgreSQL data analyst. Given a database schema and a user question, write a single, executable SQL query to answer the question.

- Today's date is {pd.Timestamp.now().strftime('%Y-%m-%d')}.
- `site` can be 'winenow' or 'liq9'. If not specified, you may need to query for both.
- Return ONLY the SQL query. Do not include any explanations, markdown, or other text.

## Database Schema
{schema}

## User Question
{question}

## SQL Query
"""
    
    try:
        response = ollama.generate(
            model='llama3:8b', # A good default model. Change if you have another.
            prompt=prompt,
            options={'temperature': 0.0}, # For deterministic SQL
            stream=False
        )
        sql_query = response['response'].strip().replace("```sql", "").replace("```", "").strip()
    except Exception as e:
        print(f"❌ Ollama SQL Generation Error: {e}")
        print("   (Is 'llama3:8b' model pulled? Try 'ollama pull llama3:8b')")
        return ""
    print(f"✅ Generated SQL:\n---\n{sql_query}\n---")
    return sql_query

def execute_sql_query(engine, sql_query: str) -> pd.DataFrame:
    """Executes a SQL query and returns the result as a pandas DataFrame."""
    print("\n🔍 Step 2: Executing query against the database...")
    try:
        with engine.connect() as connection:
            df = pd.read_sql_query(text(sql_query), connection)
        print(f"✅ Found {len(df)} rows.")
        return df
    except Exception as e:
        print(f"❌ SQL Execution Error: {e}")
        return pd.DataFrame()

def generate_answer_from_data(question: str, df: pd.DataFrame) -> str:
    """Uses a local Ollama model to generate a natural language answer from the query result."""
    print("\n📝 Step 3: Generating natural language answer (using local LLM)...")
    if df.empty:
        return "I couldn't retrieve any data for that question. The query might have been incorrect or there's no data matching your criteria."

    prompt = f"""
You are a helpful and concise data analyst. A user asked a question, a SQL query was run, and the following data was returned.
Provide a clear, natural-language answer to the user's original question based on the data.

## Original Question
{question}

## Data Result (in CSV format)
{df.to_csv(index=False)}

## Answer
"""
    try:
        response = ollama.generate(
            model='llama3:8b',
            prompt=prompt,
            stream=False
        )
        answer = response['response']
        print("✅ Done.")
        return answer
    except Exception as e:
        print(f"❌ Ollama Answer Generation Error: {e}")
        return "There was an error generating the answer from the data."

# --- Main Execution ---

def interactive_main():
    """Main function to run the analyst workflow."""
    print("🚀 Initializing Local AI Data Analyst...")
    try:
        check_ollama_connection()
        engine = get_db_engine()
        schema = get_database_schema()
    except (ValueError, ConnectionError) as e:
        print(f"Error during initialization: {e}")
        return

    print("\nHello! I'm your AI Data Analyst. I can answer questions about your GSC and GA4 data.")
    print("Type your question and press Enter. Type 'exit' to quit.")

    while True:
        question = input("\n> ")
        if question.lower() in ['exit', 'quit']:
            break
        
        sql_query = generate_sql_from_question(question, schema)
        data_df = execute_sql_query(engine, sql_query)
        answer = generate_answer_from_data(question, data_df)
        
        print("\n---")
        print(answer)
        print("---\n")

if __name__ == "__main__":
    interactive_main()