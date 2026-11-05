"""Small compatibility fixes around the supplied, unchanged comparison module.

English aliases must be complete labels: PO must not match 'Components'.
The grouping, Decimal calculations and ambiguity rules remain supplied code.
"""
import re
import business_compare as original

EXTRA_ALIASES = {
    'customer': ('Customer', 'Buyer'),
    'supplier': ('Supplier Name',),
    'order_no': ('Purchase Order', 'Purchase Order Number', 'PO Number', 'Order Number', 'Order No'),
    'delivery_no': ('Delivery Note', 'Delivery No'),
    'delivery_date': ('Delivery Date',),
    'part_no': ('Part Number', 'Part No', 'Item Number'),
    'product_name': ('Product Name', 'Item Description'),
    'quantity': ('Delivered Quantity', 'Ordered Quantity', 'Delivery Quantity', 'Order Quantity'),
}
for field, extra in EXTRA_ALIASES.items():
    original.FIELD_ALIASES[field] += extra


def label_pattern(aliases):
    return '|'.join((r'(?<![A-Za-z0-9_])' + re.escape(alias) + r'(?![A-Za-z0-9_])') if re.search(r'[A-Za-z]', alias) else re.escape(alias)
                    for alias in sorted(aliases, key=len, reverse=True))


def labeled_value(text, field):
    alias = label_pattern(original.FIELD_ALIASES[field])
    stops = label_pattern([name for other, names in original.FIELD_ALIASES.items() if other != field for name in names])
    # Without a delimiter, a label must begin the paragraph. A phrase such as
    # 'LOCAL SAMPLE - NOT CUSTOMER DATA' is a heading, not Customer: DATA.
    label = rf'(?:(?:^|\n)\s*(?:{alias})\s*[:：#]?|(?:{alias})\s*[:：#])'
    match = re.search(rf'{label}\s*(.+?)(?=\s+(?:{stops})\s*[:：#]?|$)', original._plain(text), re.IGNORECASE)
    return match.group(1).strip(' ;；,，') if match else ''


def table_value(units, field):
    aliases = original.FIELD_ALIASES[field]
    pattern = label_pattern(aliases)
    for unit in units:
        if unit.get('type') != 'table':
            continue
        for row in unit.get('rows', []):
            values = [original._cell_text(cell) for cell in row]
            for index, text in enumerate(values):
                match = re.match(rf'^\s*(?:{pattern})\s*[:：#]\s*(.+)$', original._plain(text), re.IGNORECASE)
                if match:
                    return match.group(1).strip()
                if any(original._header_key(text) == original._header_key(alias) for alias in aliases):
                    # A business header row contains several labelled columns, not a metadata value.
                    if sum(original._field_for_header(value) is not None for value in values) > 2:
                        continue
                    for value in values[index + 1:]:
                        if value.strip():
                            return value.strip()
    return ''


original._extract_labeled_value = labeled_value
original._document_value_from_tables = table_value


def compare_documents(order_units, delivery_units):
    result = original.compare_documents(order_units, delivery_units)
    result['order_meta']['order_no'] = original._document_value_any(order_units, 'order_no')
    result['delivery_meta']['order_no'] = original._document_value_any(delivery_units, 'order_no')
    return result
