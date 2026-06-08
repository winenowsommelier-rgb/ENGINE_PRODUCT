#!/usr/bin/env python3
"""
An automated AI Data Analyst that generates a daily briefing using a local LLM.

This script runs a predefined set of questions against the database,
using the same Text-to-SQL -> DB Query -> Data-to-Text workflow as the
interactive analyst. It's designed to be run on a schedule (e.g., cron job)
to produce a consistent daily report.
"""

import sys
from datetime import datetime

# To reuse the functions from the interactive analyst, we can import them.
# This requires the script to be in the same directory or in Python's path.
try:
    from notebook_analyst import (
        get_db_engine,
        check_ollama_connection,
        get_database_schema,
        generate_sql_from_question,
        execute_sql_query,
        generate_answer_from_data,
    )
except ImportError:
    print("Error: This script requires 'notebook_analyst.py' to be in the same directory.")
    sys.exit(1)

# --- Daily Briefing Questions ---

QUESTIONS = [
    "What was the total organic revenue for winenow yesterday?",
    "Which 5 keywords drove the most clicks for liq9 yesterday?",
    "How did yesterday's total sessions for both sites compare to the day before?",
    "Are there any content pages with a high opportunity score right now for winenow?",
    "What was the status of the last data sync for each site?",
]


def main():
    """Main function to run the automated briefing workflow."""
    print("🚀 Generating Automated Daily Briefing (using local LLM)...")
    
    try:
        check_ollama_connection()
        engine = get_db_engine()
        schema = get_database_schema()
    except (ValueError, ConnectionError) as e:
        print(f"Error during initialization: {e}")
        return

    print("=" * 60)
    print(f"AI Data Briefing for {datetime.now().strftime('%Y-%m-%d')}")
    print("=" * 60)

    # We can run the functions from the other script in a loop.
    for i, question in enumerate(QUESTIONS, 1):
        print(f"\n--- Question {i}: {question} ---\n")
        
        # This reuses the exact same 3-step logic
        sql_query = generate_sql_from_question(question, schema)
        if not sql_query:
            print("Skipping question as no SQL was generated.")
            continue
            
        data_df = execute_sql_query(engine, sql_query)
        answer = generate_answer_from_data(question, data_df)
        
        print(answer)

    print("\n" + "=" * 60)
    print("✅ Briefing complete.")
    print("=" * 60)


if __name__ == "__main__":
    main()