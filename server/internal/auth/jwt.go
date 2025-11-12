package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims encodes the JWT payload for emdash authentication.
type Claims struct {
	UserID string `json:"userId"`
	jwt.RegisteredClaims
}

// GenerateToken issues a new HS256 JWT for the provided userId.
func GenerateToken(userID string, secret string, expiryHours int) (string, error) {
	if userID == "" {
		return "", errors.New("userId is required")
	}
	if secret == "" {
		return "", errors.New("secret is required")
	}
	if expiryHours <= 0 {
		return "", errors.New("expiryHours must be greater than zero")
	}

	now := time.Now()
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(expiryHours) * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return signed, nil
}

// VerifyToken validates the supplied JWT string and returns the embedded userId.
func VerifyToken(tokenString string, secret string) (string, error) {
	if tokenString == "" {
		return "", errors.New("token is required")
	}
	if secret == "" {
		return "", errors.New("secret is required")
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok || t.Method.Alg() != jwt.SigningMethodHS256.Alg() {
			return nil, fmt.Errorf("unexpected signing method: %s", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return "", fmt.Errorf("parse token: %w", err)
	}
	if !token.Valid {
		return "", errors.New("invalid token")
	}
	if claims.UserID == "" {
		return "", errors.New("token missing userId claim")
	}
	return claims.UserID, nil
}
