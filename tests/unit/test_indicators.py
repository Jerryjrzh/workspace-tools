"""Indicator Library Test Suite

Comprehensive unit tests for all technical indicators with edge case coverage.
Uses deterministic test data to verify exact calculations.
"""

import unittest
import numpy as np
import pandas as pd
from pathlib import Path
from typing import List, Dict, Any
from datetime import datetime

# Correct imports - use absolute paths since we'll run from project root
from processing.validator import DataValidator
from processing.indicators import IndicatorRegistry
from processing.indicators.moving_averages import MovingAverage, ExponentialMovingAverage, WeightedMovingAverage
from processing.indicators.trend import MACD, ADX


def create_test_df(n: int = 50) -> pd.DataFrame:
    """Create deterministic test data with known properties."""
    np.random.seed(42)
    dates = pd.date_range("2024-01-01", periods=n)
    # Create upward trend with some noise
    base = np.linspace(10, 30, n)
    noise = np.random.randn(n) * 0.5

    return pd.DataFrame({
        "date": dates,
        "open": base + noise - 0.2,
        "high": base + noise + 0.5,
        "low": base + noise - 0.5,
        "close": base + noise,
        "volume": np.random.randint(1000000, 5000000, n)
    }).sort_values("date").reset_index(drop=True)


class TestMovingAverages(unittest.TestCase):
    """Tests for Moving Average indicators."""

    def setUp(self):
        self.df = create_test_df(30)

    def test_sma_basic(self):
        """Test SMA with known values."""
        data = {"close": [10, 20, 30, 40, 50]}
        df = pd.DataFrame(data)
        sma = MovingAverage(period=3)
        result = sma.compute(df)

        # Expected: NaN, NaN, (10+20+30)/3=20, (20+30+40)/3=30, (30+40+50)/3=40
        expected = [np.nan, np.nan, 20.0, 30.0, 40.0]
        np.testing.assert_almost_equal(result.values.tolist(), expected)

    def test_sma_insufficient_data(self):
        """Test SMA with insufficient data."""
        df = create_test_df(5)
        sma = MovingAverage(period=10)
        result = sma.compute(df)
        assert result.values.isna().all()
        assert result.metadata["valid_from"] is None

    def test_ema_basic(self):
        """Test EMA with known values."""
        data = {"close": [10, 20, 30]}
        df = pd.DataFrame(data)
        ema = ExponentialMovingAverage(period=2)  # span=2 means alpha=2/(2+1)=2/3

        result = ema.compute(df)

        # EMA calculation:
        # First value = first close = 10
        # Second: 20 * (2/3) + 10 * (1-2/3) = 40/3 + 10/3 = 50/3 ≈ 16.667
        # Third: 30 * (2/3) + 16.667 * (1/3) = 20 + 5.556 = 25.556
        expected = [10.0, 16.66666667, 25.55555556]
        np.testing.assert_almost_equal(result.values.tolist(), expected, decimal=4)

    def test_wma_basic(self):
        """Test WMA with known values."""
        data = {"close": [10, 20, 30]}
        df = pd.DataFrame(data)
        wma = WeightedMovingAverage(period=3)
        result = wma.compute(df)

        # Expected: NaN, NaN, (10*1 + 20*2 + 30*3)/6 = 140/6 ≈ 23.333
        expected = [np.nan, np.nan, 23.33333333]
        np.testing.assert_almost_equal(result.values.tolist(), expected, decimal=4)

    def test_ma_parameter_validation(self):
        """Test parameter validation for all MA types."""
        with self.assertRaises(ValueError):
            MovingAverage(period=-1)
        with self.assertRaises(ValueError):
            ExponentialMovingAverage(period=0)
        with self.assertRaises(ValueError):
            WeightedMovingAverage(period=-5)

    def test_ma_column_validation(self):
        """Test column validation."""
        df = create_test_df()
        sma = MovingAverage(column="wrong")
        with self.assertRaises(ValueError):
            sma.compute(df)


class TestTrendIndicators(unittest.TestCase):
    """Tests for Trend indicators (MACD, ADX)."""

    def setUp(self):
        self.df = create_test_df(100)  # More data needed for trend indicators

    def test_macd_basic(self):
        """Test MACD computation with known properties."""
        macd = MACD(fast_period=12, slow_period=26, signal_period=9)
        result = macd.compute(self.df)

        # Check output structure
        assert isinstance(result.values, pd.DataFrame)
        assert set(result.values.columns) == {"macd", "signal", "hist"}
        assert len(result.values) == len(self.df)

        # Verify histogram = macd - signal
        reconstructed_hist = result.values["macd"] - result.values["signal"]
        np.testing.assert_almost_equal(result.values["hist"], reconstructed_hist)

        # Check metadata
        meta = result.metadata
        assert meta["indicator"] == "MACD"
        assert meta["fast_period"] == 12
        assert meta["slow_period"] == 26
        assert meta["signal_period"] == 9
        assert meta["valid_from"] is not None

    def test_macd_insufficient_data(self):
        """Test MACD with insufficient data."""
        df = create_test_df(10)  # Need at least slow_period + signal_period - 2 = 33 rows
        macd = MACD()
        result = macd.compute(df)

        assert result.values["macd"].isna().all()
        assert result.metadata["valid_from"] is None

    def test_macd_parameter_validation(self):
        """Test MACD parameter validation."""
        with self.assertRaises(ValueError):  # fast >= slow
            MACD(fast_period=26, slow_period=12)
        with self.assertRaises(ValueError):  # negative period
            MACD(fast_period=-1)

    def test_adx_basic(self):
        """Test ADX computation with known properties."""
        adx = ADX(period=14)
        result = adx.compute(self.df)

        # Check output structure
        assert isinstance(result.values, pd.DataFrame)
        assert set(result.values.columns) == {"adx", "plus_di", "minus_di"}
        assert len(result.values) == len(self.df)

        # Verify ADX range [0, 100]
        valid_adx = result.values["adx"].dropna()
        assert (valid_adx >= 0).all()
        assert (valid_adx <= 100).all()

        # Verify DI non-negative
        assert (result.values["plus_di"] >= 0).all()
        assert (result.values["minus_di"] >= 0).all()

    def test_adx_insufficient_data(self):
        """Test ADX with insufficient data."""
        df = create_test_df(15)  # Need at least period*2 = 28 rows
        adx = ADX(period=14)
        result = adx.compute(df)

        assert result.values["adx"].isna().all()
        assert "warning" in result.metadata

    def test_adx_parameter_validation(self):
        """Test ADX parameter validation."""
        with self.assertRaises(ValueError):
            ADX(period=-1)


class TestIndicatorRegistry(unittest.TestCase):
    """Tests for Indicator Registry factory pattern."""

    def test_registry_registration(self):
        """Verify all indicators are correctly registered."""
        available = IndicatorRegistry.list_indicators()
        expected = {"sma", "ema", "wma", "macd", "adx"}
        assert set(available) == expected

    def test_factory_creation(self):
        """Test indicator creation via factory with custom parameters."""
        sma = IndicatorRegistry.create("sma", period=50, column="high")
        assert isinstance(sma, MovingAverage)
        assert sma.params["period"] == 50
        assert sma.params["column"] == "high"

        macd = IndicatorRegistry.create("macd", fast_period=10, slow_period=20)
        assert isinstance(macd, MACD)
        assert macd.params["fast_period"] == 10

    def test_factory_invalid_name(self):
        """Test factory with unregistered indicator name."""
        with self.assertRaisesRegex(ValueError, "No registered indicator"):
            IndicatorRegistry.create("nonexistent")


class TestEdgeCases(unittest.TestCase):
    """Tests for edge cases and error handling."""

    def setUp(self):
        # Create a validator instance with default config
        self.validator = DataValidator()

    def test_empty_dataframe(self):
        """Test all indicators with empty DataFrame."""
        df = pd.DataFrame()
        indicators = [MovingAverage(), ExponentialMovingAverage(), WeightedMovingAverage(), MACD(), ADX()]

        for indicator in indicators:
            result = indicator.compute(df)
            assert len(result.values) == 0
            assert result.metadata["valid_from"] is None

    def test_single_row_dataframe(self):
        """Test all indicators with single row DataFrame."""
        df = pd.DataFrame({
            "date": [pd.Timestamp("2024-01-01")],
            "open": [10.5],
            "high": [11.0],
            "low": [10.3],
            "close": [10.8],
            "volume": [1000000]
        })
        indicators = [MovingAverage(), ExponentialMovingAverage(), WeightedMovingAverage(), MACD(), ADX()]

        for indicator in indicators:
            result = indicator.compute(df)
            assert len(result.values) == 1
            if hasattr(indicator, "params") and "period" in indicator.params:
                # EMA should have a value (converges from first row), others NaN for period > 1
                if isinstance(indicator, ExponentialMovingAverage):
                    assert not result.values.isna().all()
                else:
                    assert result.values.isna().all()

    def test_nan_handling(self):
        """Test indicators with NaN values in input data."""
        df = create_test_df(30)
        df.loc[5:7, "close"] = np.nan  # Insert NaNs

        indicators = [MovingAverage(), ExponentialMovingAverage(), WeightedMovingAverage()]

        for indicator in indicators:
            result = indicator.compute(df)
            assert result.values.isna().any()  # Should propagate NaNs appropriately
            assert not result.values.isnull().all()  # But still compute valid values where possible

    def test_large_datasets(self):
        """Test indicators with large datasets for performance."""
        df = create_test_df(10000)
        indicators = [MovingAverage(), ExponentialMovingAverage(), WeightedMovingAverage(), MACD(), ADX()]

        import time
        for indicator in indicators:
            start = time.perf_counter()
            indicator.compute(df)
            elapsed = time.perf_counter() - start
            assert elapsed < 0.5  # Should compute in under 500ms


if __name__ == "__main__":
    unittest.main()
