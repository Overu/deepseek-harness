"""Legacy signing entry disabled: credentials belong to the backend only."""

def generate_auth_headers(*args, **kwargs):
    raise RuntimeError("本地签名已移除，请使用 enterprise_proxy.request 调用后台")
