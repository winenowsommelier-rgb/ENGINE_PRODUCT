#!/usr/bin/env python3

"""
Resume Bulk Magento Data Processor
Processes remaining Magento items starting from a specific SKU
"""

import json
import os
from datetime import datetime

BATCH_SIZE = 500
RESUME_FROM_SKU = 'GWN0311AB'

def load_magento_data():
    """Load Magento data from JSON file"""
    magento_file = os.path.join(os.getcwd(), 'data', 'taxonomy', 'magento_item_data.json')
    with open(magento_file, 'r') as f:
        return json.load(f)

def load_existing_products():
    """Load existing products from database"""
    db_path = os.path.join(os.getcwd(), 'data', 'db', 'products.json')
    if os.path.exists(db_path):
        try:
            with open(db_path, 'r') as f:
                return json.load(f)
        except:
            return []
    return []

def save_product(product):
    """Save a product to the database"""
    products = load_existing_products()
    products.append(product)

    db_path = os.path.join(os.getcwd(), 'data', 'db', 'products.json')
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    with open(db_path, 'w') as f:
        json.dump(products, f, indent=2)

def save_batch_log(log):
    """Save batch log"""
    log_path = os.path.join(os.getcwd(), 'data', 'db', 'batch-logs.json')

    logs = []
    if os.path.exists(log_path):
        try:
            with open(log_path, 'r') as f:
                logs = json.load(f)
        except:
            logs = []

    logs.append(log)

    with open(log_path, 'w') as f:
        json.dump(logs, f, indent=2)

def process_batch(rows, batch_id):
    """Simple batch processing"""
    processed_rows = []
    for idx, row in enumerate(rows):
        processed_rows.append({
            'id': f'row-{idx}-{int(datetime.now().timestamp() * 1000)}',
            'sku': row.get('sku', ''),
            'name': row.get('name', ''),
            'country': row.get('country', ''),
            'region': row.get('region', ''),
            'classification': 'Wine product',
            'grape_variety': row.get('grape_variety', ''),
            'price': float(row.get('price', 0)),
            'cost': float(row.get('cost', 0)),
            'is_in_stock': row.get('is_in_stock', 0),
            'confidence': 0.8,
            'status': 'ready'
        })

    return {
        'rows': processed_rows,
        'stats': {
            'total': len(rows),
            'ready': len(rows),
            'review': 0,
            'blocked': 0
        }
    }

def main():
    print('🚀 Resuming bulk Magento data processing...\n')

    try:
        # Load Magento data
        magento_data = load_magento_data()
        all_items = magento_data.get('data', [])

        print(f'📊 Found {len(all_items)} total Magento items\n')

        # Find resume point
        start_index = 0
        if RESUME_FROM_SKU:
            for idx, item in enumerate(all_items):
                if item.get('sku') == RESUME_FROM_SKU:
                    start_index = idx + 1
                    print(f'🔄 Resuming from SKU "{RESUME_FROM_SKU}" (index {start_index})\n')
                    break
            else:
                print(f'⚠️  Resume SKU "{RESUME_FROM_SKU}" not found, starting from beginning\n')

        items_to_process = all_items[start_index:]
        print(f'📊 Processing {len(items_to_process)} remaining items\n')

        total_processed = 0
        total_ready = 0
        total_issues = 0

        # Process in batches
        for i in range(0, len(items_to_process), BATCH_SIZE):
            batch_items = items_to_process[i:i + BATCH_SIZE]
            batch_number = (start_index + i) // BATCH_SIZE + 1
            total_batches = (len(all_items) + BATCH_SIZE - 1) // BATCH_SIZE

            print(f'🔄 Processing batch {batch_number}/{total_batches} ({len(batch_items)} items)...')

            # Convert to processing format
            rows = []
            for item in batch_items:
                rows.append({
                    'sku': item.get('sku', ''),
                    'name': item.get('name', ''),
                    'country': item.get('country', ''),
                    'region': item.get('region') or item.get('region_wine', ''),
                    'wine_type': item.get('wine_type', ''),
                    'liquor_main_type': item.get('liquor_main_type', ''),
                    'grape_variety': item.get('grape_variety') or item.get('grape_class', ''),
                    'price': float(item.get('price', 0)),
                    'cost': float(item.get('cost', 0)),
                    'brand': item.get('brand') or item.get('manufacturer', ''),
                    'vintage': item.get('vintage', ''),
                    'alcohol': item.get('alcohol', ''),
                    'bottle_size': item.get('bottle_size', ''),
                    'is_in_stock': item.get('is_in_stock', 0),
                })

            # Process batch
            batch_result = process_batch(rows, f'magento-batch-{batch_number}')

            # Save products
            batch_saved = 0
            batch_issues = 0

            for row in batch_result['rows']:
                try:
                    product = {
                        'id': row['id'],
                        'sku': row['sku'],
                        'name': row['name'],
                        'country': row['country'],
                        'region': row['region'],
                        'subregion': '',
                        'origin': '',
                        'classification': row['classification'],
                        'origin_source': '',
                        'classification_source': '',
                        'grape_variety': row['grape_variety'],
                        'price': row['price'],
                        'cost': row['cost'],
                        'currency': 'THB',
                        'quantity_in_stock': row['is_in_stock'],
                        'taxonomy_confidence': row['confidence'],
                        'description_confidence': 0,
                        'overall_confidence': row['confidence'],
                        'validation_status': 'validated' if row['status'] == 'ready' else 'needs_review',
                        'full_description': row['name'],
                        'flavor_profile': '[]',
                        'character_traits': '[]',
                        'batch_id': f'magento-batch-{batch_number}',
                        'source_file': 'magento-bulk-resume-python',
                        'created_at': datetime.now().isoformat(),
                        'updated_at': datetime.now().isoformat(),
                        'image_url': None,
                        'image_scraped_url': None,
                        'image_local_path': None,
                        'image_alt_text': None,
                    }
                    save_product(product)
                    batch_saved += 1
                except Exception as e:
                    print(f'❌ Error saving product {row["sku"]}: {str(e)}')
                    batch_issues += 1

            # Save batch log
            log_entry = {
                'id': f'batch-{int(datetime.now().timestamp() * 1000)}',
                'source_file': 'magento-bulk-resume-python',
                'source_type': 'script',
                'total_rows': len(batch_items),
                'processed_rows': batch_result['stats']['total'],
                'ready_rows': batch_result['stats']['ready'],
                'review_rows': batch_result['stats']['review'],
                'blocked_rows': batch_result['stats']['blocked'],
                'status': 'completed',
                'notes': f'Processed {batch_result["stats"]["total"]} products with {batch_issues} issues',
                'timestamp': datetime.now().isoformat()
            }
            save_batch_log(log_entry)

            total_processed += batch_result['stats']['total']
            total_ready += batch_result['stats']['ready']
            total_issues += batch_issues

            print(f'✅ Batch {batch_number} completed: {batch_saved} saved, {batch_issues} issues\n')

        print('🎉 Bulk processing completed!')
        print(f'📊 Total processed: {total_processed}')
        print(f'✅ Ready: {total_ready}')
        print(f'⚠️  Issues: {total_issues}')

    except Exception as e:
        print(f'❌ Bulk processing failed: {str(e)}')
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()