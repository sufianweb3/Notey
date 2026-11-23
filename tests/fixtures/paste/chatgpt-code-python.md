You can parse the CSV with the standard library:

```python
import csv

with open("orders.csv", newline="") as f:
    for row in csv.DictReader(f):
        print(row["id"], row["total"])
```

If the file is large, use `pandas.read_csv` with `chunksize` instead.
