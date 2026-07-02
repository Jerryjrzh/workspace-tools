"""Indicator Library - Base Classes

Defines the standard interface for all technical indicators.
All indicators must inherit from this base class and implement compute() method.
"""

from abc import ABC, abstractmethod
from typing import List, Dict, Optional, Union, Any
import pandas as pd
from pydantic import BaseModel


class IndicatorResult(BaseModel):
    """Indicator computation result with metadata."""
    values: Union[pd.Series, pd.DataFrame]
    metadata: Dict[str, Any] = {}

    class Config:
        arbitrary_types_allowed = True


class BaseIndicator(ABC):
    """Abstract base class for all technical indicators.

    All indicators must implement the compute() method which takes a DataFrame
    and returns an IndicatorResult containing computed values and optional metadata.

    Design Principles:
    1. Single Responsibility - Each indicator computes exactly one thing
    2. Immutability - Never modify input data, always return new Series/DataFrame
    3. Vectorized Operations - Use pandas vectorized operations for performance
    4. Fail-safe Defaults - Return NaN or sensible defaults on insufficient data

    Example:
        >>> ma = MovingAverage(period=20)
        >>> result = ma.compute(df)  # Returns IndicatorResult with values and metadata
    """

    def __init__(self, **params):
        self._validate_params()
        self.params = params

    def _validate_params(self) -> None:
        """Validate indicator parameters. Override in subclasses if needed."""
        pass

    @abstractmethod
    def compute(self, df: pd.DataFrame) -> IndicatorResult:
        """Compute the indicator values.

        Args:
            df: DataFrame containing required columns (must have 'close' at minimum).
            
        Returns:
            IndicatorResult with computed values and metadata.

        Raises:
            ValueError: If input data is insufficient or format invalid.
        """
        pass

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(params={self.params})"


class IndicatorRegistry:
    """Indicator Registry - Factory for creating indicators by name.

    Enables dynamic indicator creation and configuration from JSON/YAML config files.
    Allows registering custom indicators at runtime.
    """
    _registry: Dict[str, type] = {}

    @classmethod
    def register(cls, name: str) -> type:
        """Decorator for registering indicators.

        Args:
            name: Indicator name (used for factory creation).
            
        Example:
            @IndicatorRegistry.register("sma")
            class MovingAverage(BaseIndicator):
                ...
        """
        def wrapper(cls_type: type) -> type:
            cls._registry[name] = cls_type
            return cls_type
        return wrapper

    @classmethod
    def create(cls, name: str, **params) -> BaseIndicator:
        """Create an indicator instance by name.

        Args:
            name: Indicator name (registered name).
            params: Parameters for the indicator.
            
        Returns:
            An instance of the configured indicator.

        Raises:
            ValueError: If no such indicator exists in registry.
        """
        if name not in cls._registry:
            available = ", ".join(cls._registry.keys())
            raise ValueError(f"No registered indicator '{name}'. Available: {available}")
        return cls._registry[name](**params)

    @classmethod
    def list_indicators(cls) -> List[str]:
        """Indicator names available in registry."""
        return sorted(list(cls._registry.keys()))


# Pre-register common indicators (will be registered by their class decorators)
SMA = "sma"  # Alias for Moving Average
EMA = "ema"   # Exponential Moving Average
WMA = "wma"   # Weighted Moving Average
MACD = "macd" # Moving Average Convergence Divergence
RSI = "rsi"    # Relative Strength Index
KDJ = "kdj"    # Stochastic Oscillator (KDJ)
CCI = "cci"    # Commodity Channel Index
ATR = "atr"    # Average True Range
BBANDS = "bbands"  # Bollinger Bands
