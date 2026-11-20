"""関数のグラフの式。LaTeX（よく使う範囲）を Python（numpy）の式に変換し、Python の式は使える名前だけかを確かめる。

対応する LaTeX: 数・x・+ - * / ^、\\frac{}{}、\\sqrt{}・\\sqrt[n]{}、\\sin \\cos \\tan（\\sin^2 x なども）、
\\arcsin \\arccos \\arctan、\\sinh \\cosh \\tanh、\\exp、\\log・\\ln・\\log_{b}、|x|・\\left| \\right|、\\pi・e、
\\cdot・\\times、\\left( \\right)・[ ]・{ }、暗黙のかけ算（2x、x\\sin x、(x+1)(x-1)）。
"""

from __future__ import annotations

import ast
import re

FUNCS = {
    "sin": "np.sin", "cos": "np.cos", "tan": "np.tan", "arcsin": "np.arcsin", "arccos": "np.arccos", "arctan": "np.arctan",
    "sinh": "np.sinh", "cosh": "np.cosh", "tanh": "np.tanh", "exp": "np.exp", "ln": "np.log", "log": "np.log",
    "sec": "1/np.cos", "csc": "1/np.sin", "cot": "1/np.tan",
}
# Python の式で使える名前（np. を付けずに書いてもよい）
PY_NAMES = {
    "sin", "cos", "tan", "arcsin", "arccos", "arctan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "exp", "log", "ln",
    "log10", "log2", "sqrt", "abs", "floor", "ceil", "sign", "pi", "e", "x", "np", "where", "minimum", "maximum", "heaviside",
    "arctan2", "mod", "round", "hypot",
}


class ExprError(ValueError):
    pass


_TOKEN = re.compile(r"\s*(?:(\\[A-Za-z]+|\\[,;:! ]|\\\\)|(\d+\.?\d*|\.\d+)|([A-Za-z])|(.))")


def _tokens(s: str) -> list[str]:
    out = []
    pos = 0
    s = s.strip()
    while pos < len(s):
        m = _TOKEN.match(s, pos)
        if not m or m.end() == pos:
            break
        pos = m.end()
        tok = next(g for g in m.groups() if g is not None)
        if tok in ("\\,", "\\;", "\\:", "\\!", "\\ ", "\\left", "\\right", "\\displaystyle", "\\dfrac", "\\tfrac"):
            if tok in ("\\dfrac", "\\tfrac"):
                out.append("\\frac")
            continue
        if tok.strip():
            out.append(tok)
    return out


class _P:
    def __init__(self, toks: list[str], names: tuple[str, ...] = ("x",)):
        self.t = toks
        self.i = 0
        self.names = names

    def peek(self) -> str | None:
        return self.t[self.i] if self.i < len(self.t) else None

    def take(self, want: str | None = None) -> str:
        tok = self.peek()
        if tok is None or (want is not None and tok != want):
            raise ExprError(f"「{want}」が必要です" if want else "式が途中で終わっています")
        self.i += 1
        return tok

    # expr := term (('+'|'-') term)*
    def expr(self, stop=()) -> str:
        parts = [self.term(stop)]
        while self.peek() in ("+", "-"):
            op = self.take()
            parts.append(op)
            parts.append(self.term(stop))
        return " ".join(parts)

    # term := factor ((('*'|'/'|\cdot|\times)? factor)*)   暗黙のかけ算も
    def term(self, stop=()) -> str:
        out = self.unary(stop)
        while True:
            tok = self.peek()
            if tok in ("*", "\\cdot", "\\times"):
                self.take()
                out = f"({out})*({self.unary(stop)})"
            elif tok in ("/", "\\div"):
                self.take()
                out = f"({out})/({self.unary(stop)})"
            elif tok is not None and tok not in ("+", "-", ")", "]", "}", "|", "=") and tok not in stop:
                # 関数の引数（\sin 2x など）は、次の関数（\cos など）の前で終わる: \sin x \cos y = sin(x)·cos(y)
                if "\\cmd" in stop and tok.startswith("\\") and tok != "\\pi" and tok[1:] not in self.names:
                    return out
                out = f"({out})*({self.unary(stop)})"  # 暗黙のかけ算
            else:
                return out

    def unary(self, stop=()) -> str:
        if self.peek() == "-":
            self.take()
            return f"-({self.unary(stop)})"
        if self.peek() == "+":
            self.take()
        return self.power(stop)

    # power := atom ('^' atom)?
    def power(self, stop=()) -> str:
        base = self.atom(stop)
        if self.peek() == "^":
            self.take()
            ex = self.group_or_atom()
            return f"({base})**({ex})"
        return base

    def group_or_atom(self) -> str:
        if self.peek() == "{":
            self.take()
            e = self.expr()
            self.take("}")
            return e
        tok = self.take()
        return self._simple(tok)  # x^10 のような複数桁は、そのまま 10 乗とみなす

    def _simple(self, tok: str) -> str:
        if tok in self.names:
            return tok
        if tok == "e":
            return "np.e"
        if tok == "\\pi":
            return "np.pi"
        if re.fullmatch(r"\d+\.?\d*|\.\d+", tok):
            return tok
        raise ExprError(f"「{tok}」は使えません（変数は {'・'.join(self.names)} だけです）")

    def atom(self, stop=()) -> str:
        tok = self.take()
        if tok in ("(", "[", "{"):
            close = {"(": ")", "[": "]", "{": "}"}[tok]
            e = self.expr()
            self.take(close)
            return f"({e})"
        if tok == "|":
            e = self.expr(stop=("|",))
            self.take("|")
            return f"np.abs({e})"
        if tok == "\\frac":
            a = self.braced()
            b = self.braced()
            return f"(({a})/({b}))"
        if tok == "\\sqrt":
            if self.peek() == "[":
                self.take("[")
                n = self.expr()
                self.take("]")
                a = self.braced()
                return f"np.power({a}, 1/({n}))"
            return f"np.sqrt({self.braced_or_atom()})"
        if tok in ("\\abs",):
            return f"np.abs({self.braced()})"
        if tok == "\\log" and self.peek() == "_":
            self.take()
            b = self.group_or_atom()
            arg = self.func_arg()
            return f"(np.log({arg})/np.log({b}))"
        name = tok[1:] if tok.startswith("\\") else None
        if name in FUNCS:
            power = None
            if self.peek() == "^":  # \sin^2 x
                self.take()
                power = self.group_or_atom()
            arg = self.func_arg()
            f = FUNCS[name]
            call = f"({f}({arg}))" if f.startswith("1/") else f"{f}({arg})"
            return f"({call})**({power})" if power else call
        if tok.startswith("\\") and tok[1:] in self.names:  # \alpha などの名前の値（スライドの値）
            return tok[1:]
        if tok.startswith("\\") and tok != "\\pi":
            raise ExprError(f"「{tok}」は使えません")
        return self._simple(tok)

    def braced(self) -> str:
        self.take("{")
        e = self.expr()
        self.take("}")
        return e

    def braced_or_atom(self) -> str:
        return self.braced() if self.peek() == "{" else self.atom()

    def func_arg(self) -> str:
        """関数の引数: (…) や {…} があればその中、無ければ次の項（\\sin 2x → sin(2*x)）。"""
        if self.peek() in ("(", "{", "["):
            return self.atom()
        return self.term(stop=("+", "-", "\\cmd"))


def latex_to_python(latex: str, names: tuple[str, ...] = ("x",)) -> str:
    """names は変数（グラフは x、ベクトル場は x と y）。"""
    s = (latex or "").strip().strip("$")
    if names == ("x",):
        s = re.sub(r"^\s*(?:y|f\s*\(\s*x\s*\))\s*=", "", s)  # 「y =」「f(x) =」は取り除く
    toks = _tokens(s)
    if not toks:
        raise ExprError("式が空です")
    p = _P(toks, names)
    out = p.expr()
    if p.peek() is not None:
        raise ExprError(f"「{p.peek()}」の扱いが分かりません")
    check_python(out, names)
    return out


def check_python(expr: str, names: tuple[str, ...] = ("x",)) -> str:
    """Python の式を確かめる（names の関数で、使える名前・書き方だけか）。問題があれば ExprError。"""
    expr = (expr or "").strip()
    if not expr:
        raise ExprError("式が空です")
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        raise ExprError(f"Python の式として読めません（{e.msg}）") from e
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id not in PY_NAMES | set(names):
            raise ExprError(f"「{node.id}」は使えません（変数は {'・'.join(names)}、関数は sin・cos・exp・sqrt・log など）")
        if isinstance(node, ast.Attribute):
            if not (isinstance(node.value, ast.Name) and node.value.id == "np"):
                raise ExprError("属性は np.〇〇 の形だけ使えます")
            if node.attr.startswith("_"):
                raise ExprError(f"「np.{node.attr}」は使えません")
        if isinstance(node, (ast.Lambda, ast.Call)) and isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id not in PY_NAMES - {"x"}:
                raise ExprError(f"関数「{node.func.id}」は使えません")
        if isinstance(node, (ast.Lambda, ast.ListComp, ast.GeneratorExp, ast.DictComp, ast.SetComp, ast.NamedExpr, ast.Subscript)):
            raise ExprError("この書き方は使えません")
    return expr


def to_python(expr: str, lang: str, names: tuple[str, ...] = ("x",)) -> str:
    return latex_to_python(expr, names) if lang == "latex" else check_python(expr, names)


def used_names(py_expr: str, names) -> list[str]:
    """Python の式の中で使っている names（スライドの値など）の名前（出てくる順）。"""
    out: list[str] = []
    for node in ast.walk(ast.parse(py_expr, mode="eval")):
        if isinstance(node, ast.Name) and node.id in names and node.id not in out:
            out.append(node.id)
    return out
