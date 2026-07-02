"""Data Providers Module

Implements different data source providers for financial market data.
Supports TDX (TongDaxin) binary format and standard CSV files.
"""

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Dict, Optional
import pandas as pd
import numpy as np
import struct


class BaseDataProvider(ABC):
    """Abstract base class for data providers."""

    def __init__(self, base_path: Path):
        self.base_path = base_path

    @abstractmethod
    def load_data(self, symbol: str) -> pd.DataFrame:
        """Load historical data for a given symbol.

        Returns:
            DataFrame with columns: [date, open, high, low, close, volume]
        """
        pass

    @abstractmethod
    def available_symbols(self) -> List[str]:
        """List all symbols available in this data source."""
        pass


class CSVDataProvider(BaseDataProvider):
    """CSV Data Provider for loading stock data from CSV files.

    Expected format: date,open,high,low,close,volume (or similar with headers)
    """

    def load_data(self, symbol: str) -> pd.DataFrame:
        file = self.base_path / f"{symbol}.csv"
        if not file.exists():
            raise FileNotFoundError(f"No CSV data found for {symbol}")

        df = pd.read_csv(file)
        return self._parse(df, symbol)

    def _parse(self, df: pd.DataFrame, symbol: str) -> pd.DataFrame:
        required = ["date", "open", "high", "low", "close", "volume"]
        missing = [col for col in required if col not in df.columns]
        if missing:
            raise ValueError(f"CSV for {symbol} missing columns: {missing}")

        df["date"] = pd.to_datetime(df["date"])
        df[["open", "high", "low", "close"]] = df[["open", "high", "low", "close"]].astype(float)
        df["volume"] = df["volume"].astype(int)
        return df.sort_values("date").reset_index(drop=True)

    def available_symbols(self) -> List[str]:
        return [f.stem for f in self.base_path.glob("*.csv")]


class TDXDataProvider(BaseDataProvider):
    """TDX Data Provider for parsing TongDaxin binary files.

    TDX format: Binary files with fixed-length records, little-endian encoding.
    Each record is 32 bytes containing date, open, high, low, close, volume, amount.
    """

    RECORD_SIZE = 32  # Bytes per bar in TDX format

    def __init__(self, base_path: Path):
        super().__init__(base_path)
        self._symbol_map = self._build_symbol_map()

    def _build_symbol_map(self) -> Dict[str, str]:
        """Build mapping from stock symbol to TDX filename."""
        mapping = {}
        for file in self.base_path.glob("*.dat"):
            # Extract 6-digit code from filename (e.g., sh600519.dat -> sh600519)
            code = file.stem[:8]  # Adjust based on actual naming convention
            mapping[code] = file.name
        return mapping

    def load_data(self, symbol: str) -> pd.DataFrame:
        filename = self._symbol_map.get(symbol)
        if not filename:
            raise FileNotFoundError(f"TDX data not found for {symbol}")

        path = self.base_path / filename
        return self._parse_binary(path, symbol)

    def _parse_binary(self, path: Path, symbol: str) -> pd.DataFrame:
        """Parse TDX binary format with proper endianness handling."""
        data = []
        with open(path, "rb") as f:
            while chunk := f.read(self.RECORD_SIZE):
                if len(chunk) < self.RECORD_SIZE:
                    break

                # TDX uses little-endian for most fields but date is often big-endian
                date_raw = int.from_bytes(chunk[0:4], "little")  # YYYYMMDD
                open_price = int.from_bytes(chunk[4:8], "little") / 100
                high_price = int.from_bytes(chunk[8:12], "little") / 100
                low_price = int.from_bytes(chunk[12:16], "little") / 100
                close_price = int.from_bytes(chunk[16:20], "little") / 100
                volume = int.from_bytes(chunk[20:24], "little")  # Volume in lots (1 lot = 100 shares)
                amount = int.from_bytes(chunk[24:28], "little") / 100

                date_str = str(date_raw)
                if len(date_str) == 8:  # YYYYMMDD format
                    formatted_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
                else:
                    continue

                data.append({
                    "date": formatted_date,
                    "open": open_price,
                    "high": high_price,
                    "low": low_price,
                    "close": close_price,
                    "volume": volume * 100  # Convert lots to shares
                })

        df = pd.DataFrame(data)
        if df.empty:
            raise ValueError(f"No valid data parsed from {path}")

        df["date"] = pd.to_datetime(df["date"])
        return df.sort_values("date").reset_index(drop=True)

    def available_symbols(self) -> List[str]:
        return list(self._symbol_map.keys())


class DataProviderFactory:
    """Factory for creating data providers based on file format."""

    @staticmethod
    def create(base_path: Path, preferred_format: str = "auto") -> BaseDataProvider:
        if preferred_format == "csv":
            return CSVDataProvider(base_path)
        elif preferred_format == "tdx":
            return TDXDataProvider(base_path)
        else:  # Auto-detect
            csv_files = list(base_path.glob("*.csv"))
            dat_files = list(base_path.glob("*.dat"))

            if dat_files and not csv_files:
                return TDXDataProvider(base_path)
            elif csv_files and not dat_files:
                return CSVDataProvider(base_path)
            else:
                # Both exist, default to CSV (more readable/debuggable)
                return CSVDataProvider(base_path)


if __name__ == "__main__":
    import sys

    test_dir = Path("data/test").mkdir(parents=True, exist_ok=True) if not os.path.exists("data") else Path("data/test")
    os.makedirs(test_dir, exist_ok=True)

    # Create test CSV
    csv_file = test_dir / "sh600519.csv"
    with open(csv_file, "w", encoding="utf-8") as f:
        f.write("date,open,high,low,close,volume\n")
        f.write("2024-01-01,10.5,11.0,10.3,10.8,1000000\n")
        f.write("2024-01-02,10.8,11.2,10.7,11.0,1500000\n")

    # Create test TDX binary (simplified)
    tdx_file = test_dir / "sh600519.dat"
    with open(tdx_file, "wb") as f:
        def pack_bar(date, o, h, l, c, v):
            return date.to_bytes(4, "little") + o.to_bytes(4, "little") + \
                   h.to_bytes(4, "little") + l.to_bytes(4, "little") + \
                   c.to_bytes(4, "little") + v.to_bytes(4, "little") + b"\x00"*8

        f.write(pack_bar(20240101, 1050, 1100, 1030, 1080, 10000))
        f.write(pack_bar(20240102, 1080, 1120, 1070, 1100, 15000))

    print("\nTesting CSVDataProvider:")
    csv_loader = CSVDataProvider(test_dir)
    df_csv = csv_loader.load_data("sh600519")
    print(df_csv)

    print("\nTesting TDXDataProvider:")
    tdx_loader = TDXDataProvider(test_dir)
    df_tdx = tdx_loader.load_data("sh600519")
    print(df_tdx)

    print("\nTesting Factory Auto-Detection (CSV preferred):")
    factory = DataProviderFactory.create(test_dir)
    print(f"Selected provider: {type(factory).__name__}")
    print(factory.load_data("sh600519").head())

    print("\nTesting Factory Explicit TDX:")
    tdx_factory = DataProviderFactory.create(test_dir, preferred_format="tdx")
    print(f"Selected provider: {type(tdx_factory).__name__}")
    print(tdx_factory.load_data("sh600519").head())

    # Cleanup test files
    csv_file.unlink()
    tdx_file.unlink
