from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..core.db import get_db
from ..core.security import decode_access_token
from ..models import AuditLog, Company, User

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from None
    user = db.get(User, int(payload["sub"]))
    if user is None or user.company_id != payload.get("cid"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    return user


def get_company(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Company:
    company = db.get(Company, user.company_id)
    if company is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Company not found")
    return company


def audit(db: Session, request: Request | None, user: User | None, action: str, detail: str | None = None, company_id: int | None = None) -> None:
    ip = request.client.host if request and request.client else None
    db.add(
        AuditLog(
            company_id=company_id or (user.company_id if user else None),
            user_id=user.id if user else None,
            action=action,
            detail=detail,
            ip=ip,
        )
    )
    db.commit()
