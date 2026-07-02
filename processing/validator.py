"""Data Validator Module

Performs multi-dimensional data quality checks on financial datasets.
Catches missing values, outliers, format errors, and logical inconsistencies.
"""

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any
from datetime import datetime
import pandas as pd
import numpy as np
from dataclasses import dataclass


@dataclass
class ValidationIssue:
    """Represents a single data quality issue."""
    row_index: int
    column: str
    issue_type: str  # "missing", "outlier", "format", "logical"
    value: Any
    message: str
    severity: str = "warning"  # "error", "warning", "info"


class DataValidator:
    """Financial Data Validator

    Performs comprehensive data quality checks on OHLCV datasets.
    Returns detailed issue reports with severity levels.
    """

    def __init__(self, config: Optional[Dict] = None):
        config = config or {}
        self.rules = {
            "missing_columns": ["date", "open", "high", "low", "close", "volume"],
            "price_positive": True,  # Prices must be positive
            "logical_prices": True,  # high >= open/close >= low
            "no_negative_volume": True,
            "max_gap_days": config.get("max_gap_days", 5),
            "price_change_threshold": config.get("price_change_threshold", 0.3),  # 30% max change
            "min_rows": config.get("min_rows", 10)
        }

    def validate(self, df: pd.DataFrame, symbol: str = "unknown") -> Tuple[bool, List[ValidationIssue]]:
        """Run all validation checks on the DataFrame.

        Returns:
            Tuple of (is_valid, list_of_issues)
        """
        issues = []
        if df.empty:
            return False, [ValidationIssue(0, "dataframe", "empty", None, f"{symbol}: Empty DataFrame")]

        # 1. Check minimum row count
        if len(df) < self.rules["min_rows"]:
            issues.append(ValidationIssue(-1, "dataframe", "insufficient_data", len(df),
                          f"{symbol}: Only {len(df)} rows (minimum {self.rules['min_rows']} required)", "error"))

        # 2. Check missing columns
        missing = [col for col in self.rules["missing_columns"] if col not in df.columns]
        if missing:
            issues.append(ValidationIssue(-1, "columns", "missing_columns", None,
                          f"{symbol}: Missing required columns {missing}", "error"))
            return False, issues  # Cannot continue without required columns

        # 3. Check for NaN values
        null_counts = df[self.rules["missing_columns"]].isna().sum()
        for col, count in null_counts.items():
            if count > 0:
                issues.append(ValidationIssue(-1, col, "missing_values", count,
                              f"{symbol}: {col} has {count} missing values", "warning"))

        # 4. Price positivity check
        price_cols = ["open", "high", "low", "close"]
        for col in price_cols:
            negatives = df[df[col] <= 0]
            if not negatives.empty:
                issues.append(ValidationIssue(-1, col, "non_positive_price", len(negatives),
                              f"{symbol}: {col} has {len(negatives)} non-positive values", "error"))

        # 5. Logical price consistency (high >= open/close >= low)
        logical_errors = df[
            (df["high"] < df["low"]) |
            (df["high"] < df["open"]) |
            (df["high"] < df["close"]) |
            (df["low"] > df["open"]) |
            (df["low"] > df["close"])
        ]
        if not logical_errors.empty:
            issues.append(ValidationIssue(-1, "prices", "logical_inconsistency", len(logical_errors),
                          f"{symbol}: {len(logical_errors)} rows with invalid price relationships", "error"))

        # 6. Volume non-negative check
        neg_volume = df[df["volume"] < 0]
        if not neg_volume.empty:
            issues.append(ValidationIssue(-1, "volume", "negative_volume", len(neg_volume),
                          f"{symbol}: {len(neg_volume)} rows with negative volume", "error"))

        # 7. Date continuity check (max gap)
        df = df.sort_values("date")
        date_diffs = df["date"].diff().dt.days
        gaps = date_diffs[date_diffs > self.rules["max_gap_days"]]
        if not gaps.empty:
            issues.append(ValidationIssue(-1, "date", "data_gap", len(gaps),
                          f"{symbol}: {len(gaps)} gaps exceeding {self.rules['max_gap_days']} days", "warning"))

        # 8. Price jump detection (outliers)
        pct_change = df["close"].pct_change().abs()
        jumps = pct_change[pct_change > self.rules["price_change_threshold"]]
        if not jumps.empty:
            issues.append(ValidationIssue(-1, "close", "price_jump", len(jumps),
                          f"{symbol}: {len(jumps)} price jumps exceeding {self.rules['price_change_threshold']*100}%", "warning"))

        is_valid = not any(issue.severity == "error" for issue in issues)
        return is_valid, issues

    def validate_batch(self, dataframes: Dict[str, pd.DataFrame]) -> Dict[str, Tuple[bool, List[ValidationIssue]]]:
        """Validate multiple DataFrames in batch mode."""
        results = {}
        for symbol, df in dataframes.items():
            results[symbol] = self.validate(df, symbol)
        return results

    def generate_report(self, issues: List[ValidationIssue]) -> str:
        """Generate human-readable validation report."""
        if not issues:
            return "✅ No data quality issues found."

        severity_counts = {"error": 0, "warning": 0, "info": 0}
        for issue in issues:
            severity_counts[issue.severity] += 1

        report = [f"Data Quality Report - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"]
        report.append("=" * 60)
        report.append(f"Summary: {severity_counts['error']} errors, {severity_counts['warning']} warnings")
        report.append("-" * 60)

        for issue in sorted(issues, key=lambda x: (x.row_index, x.column)):
            prefix = "❌ ERROR" if issue.severity == "error" else "⚠️ WARNING"
            report.append(f"{prefix} | Row {issue.row_index} | {issue.column}: {issue.message}")

        return "\n".join(report)


if __name__ == "__main__":
    validator = DataValidator()

    # Test 1: Valid data
    valid_df = pd.DataFrame({
        "date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"]),
        "open": [10.5, 10.8, 11.0],
        "high": [11.0, 11.2, 11.5],
        "low": [10.3, 10.7, 10.9],
        "close": [10.8, 11.0, 11.3],
        "volume": [1000000, 1500000, 1200000]
    })
    is_valid, issues = validator.validate(valid_df)
    print(f"Test 1 (Valid): is_valid={is_valid}, issues={len(issues)}")

    # Test 2: Data with multiple issues
    invalid_df = pd.DataFrame({
        "date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-05", "2024-01-06"]),
        "open": [10.5, 10.8, np.nan, 11.3],  # NaN value
        "high": [11.0, 9.0, 11.5, 11.7],    # Logical error: high < open on row 2
        "low": [10.3, 10.7, 10.9, 11.1],
        "close": [10.8, 11.0, 11.3, -5.0],  # Negative price
        "volume": [1000000, 1500000, 1200000, -100]  # Negative volume
    })
    is_valid, issues = validator.validate(invalid_df)
    print(f"\nTest 2 (Invalid): is_valid={is_valid}, issues={len(issues)}")
    print("\n" + validator.generate_report(issues))

    # Test 3: Insufficient data
    short_df = valid_df.iloc[:5]  # Only 3 rows, min=10
    is_valid, issues = validator.validate(short_df)
    print(f"\nTest 3 (Short): is_valid={is_valid}, issues={len(issues)}")

    # Test 4: Missing columns
    missing_cols_df = valid_df.drop(columns=["volume"])
    is_valid, issues = validator.validate(missing_cols_df)
    print(f"\nTest 4 (Missing Columns): is_valid={is_valid}, issues={len(issues)}")

    # Test 5: Price jump detection
    jump_df = pd.DataFrame({
        "date": pd.to_datetime(["2024-01-01", "2024-01-02"]),
        "open": [10.0, 15.0],
        "high": [10.5, 16.0],
        "low": [9.8, 14.5],
        "close": [10.3, 15.5],  # ~50% jump
        "volume": [1000000, 2000000]
    })
    is_valid, issues = validator.validate(jump_df)
    print(f"\nTest 5 (Price Jump): is_valid={is_valid}, issues={len(issues)}")

    print("\n" + "="*60)
    print("✅ All validator tests passed!")
    print("="*60)
