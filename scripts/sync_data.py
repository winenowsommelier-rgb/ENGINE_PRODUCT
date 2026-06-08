#!/usr/bin/env python3
"""
Daily Data Sync for WNLQ9 SEO + AEO Data Hub.

This script pulls data from Google Search Console and Google Analytics 4
and upserts it into the Supabase database. It is designed to be run daily.

It requires the following environment variables:
- SUPABASE_DB_URL: Your full Supabase Postgres connection string.
- GOOGLE_SERVICE_ACCOUNT_JSON: The JSON content of your Google service account key.
"""

import os
import sys
import json
import uuid
from datetime import datetime, timedelta

import pandas as pd
from sqlalchemy import create_engine, text
from google.oauth2 import service_account
from googleapiclient.discovery import build

# --- Configuration ---

SITE_MAP = {
    "winenow": "https://th.wine-now.com/",
    "liq9": "https://th.liq9.com/",
}

GA4_PROPERTY_MAP = {
    "winenow": "377750759",
    "liq9": "377924618",
}

DAYS_TO_FETCH = 30 # Fetch data for the last 30 days on each run.

# --- Database Functions ---

def get_db_engine():
    """Creates and returns a SQLAlchemy engine for the Supabase DB."""
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        raise ValueError("SUPABASE_DB_URL environment variable is not set.")
    return create_engine(db_url)

def log_sync_start(engine, site, run_id):
    """Logs the start of a sync run."""
    print(f"[{site}] Logging sync start with run_id: {run_id}")
    with engine.connect() as conn:
        conn.execute(text("""
            INSERT INTO sync_log (run_id, site, status)
            VALUES (:run_id, :site, 'running')
        """), {"run_id": run_id, "site": site})
        conn.commit()

def log_sync_end(engine, run_id, status, rows_written, error_msg=None):
    """Logs the end of a sync run."""
    print(f"[{run_id}] Logging sync end. Status: {status}, Rows: {rows_written}")
    with engine.connect() as conn:
        conn.execute(text("""
            UPDATE sync_log
            SET completed_at = now(),
                status = :status,
                rows_written = :rows_written,
                error_msg = :error_msg,
                duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
            WHERE run_id = :run_id
        """), {
            "run_id": run_id,
            "status": status,
            "rows_written": rows_written,
            "error_msg": error_msg
        })
        conn.commit()

def upsert_df(engine, df, table_name, unique_cols):
    """
    Upserts a pandas DataFrame into a PostgreSQL table.
    This function writes the DataFrame to a temporary table, then uses SQL
    to perform an INSERT ... ON CONFLICT DO UPDATE operation.
    """
    if df.empty:
        return 0

    temp_table_name = f"temp_{table_name}_{uuid.uuid4().hex[:6]}"
    update_cols = [col for col in df.columns if col not in unique_cols]

    with engine.connect() as conn:
        df.to_sql(temp_table_name, conn, if_exists='replace', index=False)

        update_clause = ", ".join([f"{col} = EXCLUDED.{col}" for col in update_cols])
        unique_clause = ", ".join(unique_cols)

        upsert_sql = f"""
            INSERT INTO {table_name} ({', '.join(df.columns)})
            SELECT {', '.join(df.columns)} FROM {temp_table_name}
            ON CONFLICT ({unique_clause}) DO UPDATE
            SET {update_clause};
        """
        conn.execute(text(upsert_sql))
        conn.execute(text(f"DROP TABLE {temp_table_name};"))
        conn.commit()

    return len(df)

# --- Google API Functions ---

def get_google_creds():
    """Loads Google service account credentials from environment variable."""
    raw_creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw_creds:
        raise ValueError("GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set.")
    return service_account.Credentials.from_service_account_info(json.loads(raw_creds))

def fetch_gsc_data(creds, site_url, start_date, end_date):
    """Fetches daily aggregate and top keywords from GSC."""
    print(f"Fetching GSC data for {site_url} from {start_date} to {end_date}...")
    gsc_service = build('searchconsole', 'v1', credentials=creds)

    # Daily aggregate data
    request_body = {
        'startDate': start_date,
        'endDate': end_date,
        'dimensions': ['date']
    }
    response = gsc_service.searchanalytics().query(siteUrl=site_url, body=request_body).execute()
    daily_rows = []
    for row in response.get('rows', []):
        daily_rows.append({
            'date': row['keys'][0],
            'clicks': row['clicks'],
            'impressions': row['impressions'],
            'avg_ctr': row['ctr'],
            'avg_position': row['position']
        })
    daily_df = pd.DataFrame(daily_rows)

    # Top 100 keywords for the most recent day
    request_body_kw = {
        'startDate': end_date,
        'endDate': end_date,
        'dimensions': ['query'],
        'rowLimit': 100
    }
    response_kw = gsc_service.searchanalytics().query(siteUrl=site_url, body=request_body_kw).execute()
    kw_rows = []
    for row in response_kw.get('rows', []):
        kw_rows.append({
            'snapshot_date': end_date,
            'keyword': row['keys'][0],
            'clicks': row['clicks'],
            'impressions': row['impressions'],
            'avg_ctr': row['ctr'],
            'avg_position': row['position']
        })
    keywords_df = pd.DataFrame(kw_rows)

    print(f"Found {len(daily_df)} daily records and {len(keywords_df)} keywords.")
    return daily_df, keywords_df

def fetch_ga4_data(creds, property_id, start_date, end_date):
    """Fetches daily aggregate data from GA4."""
    print(f"Fetching GA4 data for property {property_id} from {start_date} to {end_date}...")
    ga4_service = build('analyticsdata', 'v1beta', credentials=creds)

    request_body = {
        'dateRanges': [{'startDate': start_date, 'endDate': end_date}],
        'dimensions': [{'name': 'date'}],
        'metrics': [
            {'name': 'sessions'},
            {'name': 'totalUsers'},
            {'name': 'newUsers'},
            {'name': 'ecommercePurchases'},
            {'name': 'purchaseRevenue'},
        ],
        'orderBys': [{'dimension': {'dimensionName': 'date'}, 'desc': False}],
    }
    response = ga4_service.properties().runReport(property=f"properties/{property_id}", body=request_body).execute()

    rows = []
    for row in response.get('rows', []):
        rows.append({
            'date': datetime.strptime(row['dimensionValues'][0]['value'], '%Y%m%d').strftime('%Y-%m-%d'),
            'sessions': int(row['metricValues'][0]['value']),
            'users': int(row['metricValues'][1]['value']),
            'new_users': int(row['metricValues'][2]['value']),
            'purchases': int(row['metricValues'][3]['value']),
            'revenue': float(row['metricValues'][4]['value']),
        })
    ga4_df = pd.DataFrame(rows)
    print(f"Found {len(ga4_df)} GA4 daily records.")
    return ga4_df

# --- Main Execution ---

def sync_site(engine, creds, site):
    """Runs the full sync process for a single site."""
    run_id = uuid.uuid4()
    log_sync_start(engine, site, run_id)
    total_rows_written = 0
    error_messages = []

    try:
        end_date = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
        start_date = (datetime.now() - timedelta(days=DAYS_TO_FETCH)).strftime('%Y-%m-%d')

        # 1. GSC Sync
        try:
            gsc_daily_df, gsc_keywords_df = fetch_gsc_data(creds, SITE_MAP[site], start_date, end_date)
            gsc_daily_df['site'] = site
            gsc_keywords_df['site'] = site
            total_rows_written += upsert_df(engine, gsc_daily_df, 'gsc_daily', ['site', 'date'])
            total_rows_written += upsert_df(engine, gsc_keywords_df, 'gsc_keywords', ['site', 'snapshot_date', 'keyword'])
        except Exception as e:
            print(f"❌ GSC Sync Error for {site}: {e}")
            error_messages.append(f"GSC Error: {e}")

        # 2. GA4 Sync
        try:
            ga4_daily_df = fetch_ga4_data(creds, GA4_PROPERTY_MAP[site], start_date, end_date)
            ga4_daily_df['site'] = site
            total_rows_written += upsert_df(engine, ga4_daily_df, 'ga4_daily', ['site', 'date'])
        except Exception as e:
            print(f"❌ GA4 Sync Error for {site}: {e}")
            error_messages.append(f"GA4 Error: {e}")

        # 3. Rebuild content_signals (Placeholder for future implementation)
        # print(f"[{site}] Skipping content_signals rebuild (not yet implemented).")

        # 4. Log completion
        status = 'ok' if not error_messages else 'partial'
        log_sync_end(engine, run_id, status, total_rows_written, "; ".join(error_messages))
        print(f"✅ [{site}] Sync complete. Status: {status}, Total rows written: {total_rows_written}")

    except Exception as e:
        print(f"❌ CRITICAL Sync Error for {site}: {e}")
        log_sync_end(engine, run_id, 'error', total_rows_written, str(e))

def main():
    """Main function to initialize and run sync for all sites."""
    print("🚀 Starting Daily Data Sync...")
    try:
        engine = get_db_engine()
        creds = get_google_creds()
    except (ValueError, Exception) as e:
        print(f"Error during initialization: {e}")
        sys.exit(1)

    sites_to_sync = sys.argv[1:] if len(sys.argv) > 1 else SITE_MAP.keys()

    for site in sites_to_sync:
        if site not in SITE_MAP:
            print(f"Warning: Unknown site '{site}'. Skipping.")
            continue
        print(f"\n--- Syncing site: {site} ---")
        sync_site(engine, creds, site)

    print("\n🎉 All sync tasks finished.")

if __name__ == "__main__":
    main()