"""Moving Average Indicators

Implements SMA, EMA, and WMA with vectorized pandas operations.
All indicators return IndicatorResult objects for consistent output format.
"""

import numpy as np
import pandas as pd
from typing import Optional
from .base import BaseIndicator, IndicatorRegistry, IndicatorResult


@IndicatorRegistry.register("sma")
class MovingAverage(BaseIndicator):
    """Simple Moving Average (SMA)

    Computes the arithmetic mean of prices over a sliding window.

    Args:
        period: Number of periods for averaging (default: 20)
        column: Column to use for calculation (default: 'close')
    """

    def __init__(self, period: int = 20, column: str = "close"):
        super().__init__(period=period, column=column)

    def _validate_params(self) -> None:
        if self.params["period"] <= 0:
            raise ValueError("Period must be a positive integer")

    def compute(self, df: pd.DataFrame) -> IndicatorResult:
        """Compute SMA values.

        Args:
            df: DataFrame with price data (must contain 'column' column).

        Returns:
            IndicatorResult containing the SMA Series and metadata.
        """
        column = self.params["column"]
        if column not in df.columns:
            raise ValueError(f"Column '{column}' not found in DataFrame")

        period = self.params["period"]
        values = df[column].rolling(window=period).mean()

        return IndicatorResult(
            values=values,
            metadata={
                "indicator": "SMA",
                "period": period,
                "column": column,
                "valid_from": period - 1 if len(df) >= period else None
            }
        )


@IndicatorRegistry.register("ema")
class ExponentialMovingAverage(BaseIndicator):
    """Exponential Moving Average (EMA)

    Applies exponential weighting to price data, giving more weight to recent prices.

    Args:
        period: Number of periods for averaging (default: 20)
        column: Column to use for calculation (default: 'close')
        span: Alternative parameter to period; if set, uses span directly
    """

    def __init__(self, period: int = 20, column: str = "close", span: Optional[int] = None):
        super().__init__(period=period, column=column, span=span)

    def _validate_params(self) -> None:
        if self.params["period"] <= 0 and self.params["span"] is not None and self.params["span"] <= 0:
            raise ValueError("Period/span must be a positive integer")

    def compute(self, df: pd.DataFrame) -> IndicatorResult:
        """Compute EMA values using pandas ewm method.

        Args:
            df: DataFrame with price data (must contain 'column' column).

        Returns:
            IndicatorResult containing the EMA Series and metadata.
        """
        column = self.params["column"]
        if column not in df.columns:
            raise ValueError(f"Column '{column}' not found in DataFrame")

        period = self.params["span"] if self.params["span"] is not None else self.params["period"]
        values = df[column].ewm(span=period, adjust=False).mean()

        return IndicatorResult(
            values=values,
            metadata={
                "indicator": "EMA",
                "period": period,
                "column": column,
                "valid_from": 0  # EMA converges from first value
            }
        )


@IndicatorRegistry.register("wma")
class WeightedMovingAverage(BaseIndicator):
    """Weighted Moving Average (WMA)

    Applies linear weighting to prices over a sliding window.

    Args:
        period: Number of periods for averaging (default: 20)
        column: Column to use for calculation (default: 'close')
    """

    def __init__(self, period: int = 20, column: str = "close"):
        super().__init__(period=period, column=column)

    def _validate_params(self) -> None:
        if self.params["period"] <= 0:
            raise ValueError("Period must be a positive integer")

    def compute(self, df: pd.DataFrame) -> IndicatorResult:
        """Compute WMA values using linear weighting.

        Args:
            df: DataFrame with price data (must contain 'column' column).

        Returns:
            IndicatorResult containing the WMA Series and metadata.
        """
        column = self.params["column"]
        if column not in df.columns:
            raise ValueError(f"Column '{column}' not found in DataFrame")

        period = self.params["period"]
        values = df[column].rolling(window=period).apply(
            lambda x: np.dot(x, np.arange(1, period + 1)) / np.sum(np.arange(1, period + 1)),
            raw=True
        )

        return IndicatorResult(
            values=values,
            metadata={
                "indicator": "WMA",
                "period": period,
                "column": column,
                "valid_from": period - 1 if len(df) >= period else None
            }
        )


if __name__ == "__main__":
    import numpy as np

    # Create sample data
    data = {
        "date": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]),
        "close": [10.0, 11.0, 10.5, 12.0, 11.5],
    }
    df = pd.DataFrame(data)

    print("Testing Moving Average Indicators:\n")

    # Test SMA
    sma = MovingAverage(period=3)
    result_sma = sma.compute(df)
    print(f"SMA (period=3):\n{result_sma.values}\n")

    # Test EMA
    ema = ExponentialMovingAverage(period=3)
    result_ema = ema.compute(df)
    print(f"EMA (period=3):\n{result_ema.values}\n")

    # Test WMA
    wma = WeightedMovingAverage(period=3)
    result_wma = wma.compute(df)
    print(f"WMA (period=3):\n{result_wma.values}\n")

    # Verify results with manual calculation for SMA
    expected_sma = [np.nan, np.nan, 10.5, 11.16666667, 11.33333333]
    np.testing.assert_almost_equal(result_sma.values.tolist(), expected_sma, decimal=4)
    print("✅ SMA values verified!")

    # Verify EMA with manual calculation (first value = first close, then apply formula)
    expected_ema = [10.0, 10.5, 10.675, 11.32833333, 11.41416667]
    np.testing.assert_almost_equal(result_ema.values.tolist(), expected_ema, decimal=4)
    print("✅ EMA values verified!")

    # Verify WMA with manual calculation
    expected_wma = [np.nan, np.nan, 10.53333333, 11.26666667, 11.4]
    np.testing.assert_almost_equal(result_wma.values.tolist(), expected_wma, decimal=4)
    print("✅ WMA values verified!")

    print("\n" + "="*60)
    print("✅ All moving average indicators passed verification!")
    print("="*60)
