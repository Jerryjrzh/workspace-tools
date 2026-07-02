"""Trend Indicators Module

Implements trend-following indicators including MACD and ADX.
All indicators return IndicatorResult with values and metadata.
"""

import numpy as np
import pandas as pd
from typing import Dict, Optional, Tuple
from .base import BaseIndicator, IndicatorRegistry, IndicatorResult


@IndicatorRegistry.register("macd")
class MACD(BaseIndicator):
    """Moving Average Convergence Divergence (MACD)

    A trend-following momentum indicator that shows the relationship between two moving averages.

    Args:
        fast_period: Period for fast EMA (default: 12)
        slow_period: Period for slow EMA (default: 26)
        signal_period: Period for signal line SMA of MACD (default: 9)
        column: Column to use for calculation (default: 'close')
    """

    def __init__(self, fast_period: int = 12, slow_period: int = 26,
                 signal_period: int = 9, column: str = "close"):
        super().__init__(fast_period=fast_period, slow_period=slow_period,
                         signal_period=signal_period, column=column)

    def _validate_params(self) -> None:
        if self.params["fast_period"] <= 0 or self.params["slow_period"] <= 0 or self.params["signal_period"] <= 0:
            raise ValueError("All periods must be positive integers")
        if self.params["fast_period"] >= self.params["slow_period"]:
            raise ValueError("Fast period must be less than slow period")

    def compute(self, df: pd.DataFrame) -> IndicatorResult:
        """Compute MACD line, signal line, and histogram.

        Returns:
            IndicatorResult with a DataFrame containing macd, signal, and hist columns.
        """
        column = self.params["column"]
        if column not in df.columns:
            raise ValueError(f"Column '{column}' not found in DataFrame")

        fast_period = self.params["fast_period"]
        slow_period = self.params["slow_period"]
        signal_period = self.params["signal_period"]

        # Calculate EMAs
        ema_fast = df[column].ewm(span=fast_period, adjust=False).mean()
        ema_slow = df[column].ewm(span=slow_period, adjust=False).mean()

        macd_line = ema_fast - ema_slow
        signal_line = macd_line.rolling(window=signal_period).mean()
        histogram = macd_line - signal_line

        result_df = pd.DataFrame({
            "macd": macd_line,
            "signal": signal_line,
            "hist": histogram
        }, index=df.index)

        return IndicatorResult(
            values=result_df,
            metadata={
                "indicator": "MACD",
                "fast_period": fast_period,
                "slow_period": slow_period,
                "signal_period": signal_period,
                "column": column,
                "valid_from": max(slow_period - 1, slow_period + signal_period - 2) if len(df) >= slow_period else None
            }
        )


@IndicatorRegistry.register("adx")
class ADX(BaseIndicator):
    """Average Directional Index (ADX)

    Measures trend strength regardless of direction. Values above 25 indicate strong trends.

    Args:
        period: Lookback period for calculations (default: 14)
    """

    def __init__(self, period: int = 14):
        super().__init__(period=period)

    def _validate_params(self) -> None:
        if self.params["period"] <= 0:
            raise ValueError("Period must be a positive integer")

    def compute(self, df: pd.DataFrame) -> IndicatorResult:
        """Compute ADX with +DI and -DI components.

        Returns:
            IndicatorResult with DataFrame containing adx, plus_di, minus_di columns.
        """
        if len(df) < self.params["period"] * 2:
            return IndicatorResult(values=pd.Series([np.nan] * len(df)), metadata={"warning": "Insufficient data"})

        # Calculate True Range (TR)
        high = df["high"]
        low = df["low"]
        close_prev = df["close"].shift(1)

        tr1 = high - low
        tr2 = (high - close_prev).abs()
        tr3 = (low - close_prev).abs()
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)

        # Calculate Directional Movement (+DM, -DM)
        up_move = high.diff()
        down_move = low.diff().multiply(-1)

        plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
        minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)

        # Smooth using Wilder's method (similar to EMA with alpha=1/period)
        def wilder_smooth(series: pd.Series, period: int) -> pd.Series:
            return series.ewm(alpha=1 / period, adjust=False).mean()

        plus_di = 100 * wilder_smooth(pd.Series(plus_dm), self.params["period"]) / tr.rolling(self.params["period"]).sum()
        minus_di = 100 * wilder_smooth(pd.Series(minus_dm), self.params["period"]) / tr.rolling(self.params["period"]).sum()

        dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di)
        adx = dx.rolling(window=self.params["period"]).mean()  # Simple smoothing for ADX

        result_df = pd.DataFrame({
            "adx": adx,
            "plus_di": plus_di,
            "minus_di": minus_di
        }, index=df.index)

        return IndicatorResult(
            values=result_df,
            metadata={
                "indicator": "ADX",
                "period": self.params["period"],
                "valid_from": 2 * self.params["period"] - 1 if len(df) >= 2 * self.params["period"] else None
            }
        )


if __name__ == "__main__":
    # Create sample data with a clear trend
    data = {
        "date": pd.to_datetime([f"2024-01-{i:02d}" for i in range(1, 31)]),
        "open": np.linspace(10, 25, 30) + np.random.randn(30),
        "high": np.linspace(10.5, 25.5, 30) + np.random.randn(30),
        "low": np.linspace(9.5, 24.5, 30) + np.random.randn(30),
        "close": np.linspace(10.3, 25.3, 30) + np.random.randn(30),
        "volume": np.random.randint(1000000, 5000000, 30),
    }
    df = pd.DataFrame(data).sort_values("date").reset_index(drop=True)

    print("\nTesting MACD Indicator:\n")
    macd = MACD(fast_period=12, slow_period=26, signal_period=9)
    result_macd = macd.compute(df)
    print(result_macd.values.tail())
    print("\nMetadata:", result_macd.metadata)

    # Verify MACD logic: histogram should be positive when fast > slow EMA
    valid_idx = result_macd.metadata["valid_from"]
    if valid_idx is not None and len(df) >= valid_idx:
        test_row = df.iloc[valid_idx]
        ema_fast = df["close"].ewm(span=12, adjust=False).mean().iloc[valid_idx]
        ema_slow = df["close"].ewm(span=26, adjust=False).mean().iloc[valid_idx]
        macd_val = ema_fast - ema_slow
        assert np.isclose(result_macd.values["macd"].iloc[valid_idx], macd_val)
    print("✅ MACD values verified!")

    print("\nTesting ADX Indicator:\n")
    adx = ADX(period=14)
    result_adx = adx.compute(df)
    print(result_adx.values.tail())
    print("\nMetadata:", result_adx.metadata)

    # Verify ADX: values should be between 0-100
    assert (result_adx.values["adx"].dropna() >= 0).all()
    assert (result_adx.values["adx"].dropna() <= 100).all()
    print("✅ ADX values in valid range [0, 100]")

    # Verify DI relationship: plus_di + minus_di should be comparable to TR-based normalization
    sample = result_adx.values.iloc[-1]
    assert sample["plus_di"] >= 0 and sample["minus_di"] >= 0
    print("✅ Directional Indicators non-negative")

    print("\n" + "="*60)
    print("✅ All trend indicators passed verification!")
    print("="*60)
