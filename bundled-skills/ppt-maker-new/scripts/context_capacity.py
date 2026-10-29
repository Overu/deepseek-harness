"""Offline accounting: model capability is not a verified gateway limit."""
from dataclasses import asdict, dataclass
import json
from pathlib import Path


@dataclass(frozen=True)
class Capacity:
    context_window: int = 1050000
    max_output_tokens: int = 128000
    output_reserve_tokens: int = 128000
    safety_margin_tokens: int = 72000
    max_input_tokens: int | None = None
    chunk_target_tokens: int = 120000
    reading_output_tokens: int = 32000
    workers: int = 3
    max_reduce_rounds: int = 4
    max_split_depth: int = 8
    tokenizer_file: str | None = None

    def input_limit(self, output_tokens=0):
        if output_tokens > self.max_output_tokens:
            raise ValueError('context_capacity: requested output exceeds configured gateway output limit')
        limit = self.context_window - max(self.output_reserve_tokens, output_tokens) - self.safety_margin_tokens
        if self.max_input_tokens is not None:
            limit = min(limit, self.max_input_tokens)
        if limit <= 0:
            raise ValueError('context_capacity: no room for input after output/safety reserves')
        return limit


def load_capacity(project):
    path = Path(project) / 'context_capacity.json'
    config = json.loads(path.read_text(encoding='utf8')) if path.exists() else {}
    if not isinstance(config, dict) or set(config) - set(Capacity.__dataclass_fields__):
        raise ValueError('context_capacity: unknown configuration fields')
    policy = Capacity(**config)
    for name, value in asdict(policy).items():
        if name == 'tokenizer_file':
            if value is not None and (not isinstance(value, str) or not value):
                raise ValueError('context_capacity: tokenizer_file must name a local file')
            continue
        if name == 'max_input_tokens' and value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, int) or value < (0 if name == 'safety_margin_tokens' else 1):
            raise ValueError('context_capacity: invalid ' + name)
    if policy.output_reserve_tokens > policy.max_output_tokens or policy.reading_output_tokens > policy.max_output_tokens:
        raise ValueError('context_capacity: output reserves exceed configured output capability')
    policy.input_limit()
    return policy


def token_counter(project, policy):
    if policy.tokenizer_file:
        path = Path(policy.tokenizer_file)
        if not path.is_absolute():
            path = Path(project) / path
        from tokenizers import Tokenizer
        tokenizer = Tokenizer.from_file(str(path))
        tokenizer.no_truncation()
        tokenizer.no_padding()
        return lambda text: len(tokenizer.encode(text, add_special_tokens=False).ids), 'local_tokenizer'
    # Byte-level text tokens cannot outnumber UTF-8 bytes. This deliberately
    # overestimates, especially for CJK, and is reported as a bound, NOT usage.
    return lambda text: len(text.encode('utf8')), 'utf8_byte_upper_bound'


def split_to_fit(text, fits, target, count):
    """Lossless, paragraph-preferred splitting; check the full request."""
    offset = 0
    while offset < len(text):
        low, high, best = 1, min(len(text) - offset, target), 0
        while low <= high:
            mid = (low + high) // 2
            piece = text[offset:offset + mid]
            if count(piece) <= target and fits(piece):
                best, low = mid, mid + 1
            else:
                high = mid - 1
        if not best:
            raise ValueError('context_capacity: reading envelope leaves no room for source text')
        if offset + best < len(text):
            boundary = text.rfind('\n', offset + best // 2, offset + best)
            if boundary >= 0:
                best = boundary + 1 - offset
        piece = text[offset:offset + best]
        while not fits(piece):
            best //= 2
            if not best:
                raise ValueError('context_capacity: cannot fit one source character')
            piece = text[offset:offset + best]
        yield offset, piece
        offset += best
