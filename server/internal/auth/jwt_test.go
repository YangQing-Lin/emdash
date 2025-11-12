package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestGenerateTokenIncludesClaims(t *testing.T) {
	secret := "test-secret"
	userID := "user-123"

	start := time.Now()
	token, err := GenerateToken(userID, secret, 2)
	if err != nil {
		t.Fatalf("GenerateToken returned error: %v", err)
	}

	claims := &Claims{}
	parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil {
		t.Fatalf("ParseWithClaims failed: %v", err)
	}
	if !parsed.Valid {
		t.Fatal("expected token to be valid")
	}
	if claims.UserID != userID {
		t.Fatalf("expected userId claim %q, got %q", userID, claims.UserID)
	}

	if claims.IssuedAt == nil || claims.ExpiresAt == nil {
		t.Fatalf("expected issued and expiry claims: %+v", claims)
	}
	if issued := claims.IssuedAt.Time; issued.Before(start.Add(-time.Second)) || issued.After(time.Now().Add(time.Second)) {
		t.Fatalf("issued-at timestamp out of expected range: %v", issued)
	}
	duration := claims.ExpiresAt.Time.Sub(claims.IssuedAt.Time)
	if duration < 2*time.Hour-100*time.Millisecond || duration > 2*time.Hour+100*time.Millisecond {
		t.Fatalf("unexpected expiry duration: got %v, want ~2h", duration)
	}
}

func TestGenerateTokenValidationErrors(t *testing.T) {
	t.Parallel()
	testCases := []struct {
		name        string
		userID      string
		secret      string
		expiryHours int
	}{
		{name: "empty user", userID: "", secret: "secret", expiryHours: 1},
		{name: "empty secret", userID: "user", secret: "", expiryHours: 1},
		{name: "non-positive expiry", userID: "user", secret: "secret", expiryHours: 0},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if _, err := GenerateToken(tc.userID, tc.secret, tc.expiryHours); err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
		})
	}
}

func TestGenerateTokenEdgeUserIDs(t *testing.T) {
	secret := "edge-secret"

	longID := strings.Repeat("abc123", 300) // 1800 characters
	token, err := GenerateToken(longID, secret, 1)
	if err != nil {
		t.Fatalf("GenerateToken with long userId failed: %v", err)
	}
	if user, err := VerifyToken(token, secret); err != nil || user != longID {
		t.Fatalf("round-trip failed for long userId: user=%q err=%v", user, err)
	}

	specialID := "user-!@#$%^&*()_+-=[]{}|;':,./<>?"
	token, err = GenerateToken(specialID, secret, 1)
	if err != nil {
		t.Fatalf("GenerateToken with special chars failed: %v", err)
	}
	if user, err := VerifyToken(token, secret); err != nil || user != specialID {
		t.Fatalf("round-trip failed for special chars: user=%q err=%v", user, err)
	}

	if _, err := GenerateToken("", secret, 1); err == nil {
		t.Fatal("expected error for empty userId")
	}
}

func TestVerifyTokenScenarios(t *testing.T) {
	secret := "verify-secret"
	validToken, err := GenerateToken("valid-user", secret, 1)
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	expiredClaims := Claims{
		UserID: "expired-user",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-time.Hour)),
		},
	}
	expiredToken := signClaims(t, expiredClaims, secret)

	noUserClaims := Claims{
		UserID: "",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Minute)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	noUserToken := signClaims(t, noUserClaims, secret)

	testCases := []struct {
		name      string
		token     string
		secret    string
		wantErr   string
		expectNil bool
	}{
		{name: "valid token", token: validToken, secret: secret, expectNil: true},
		{name: "empty token", token: "", secret: secret, wantErr: "token is required"},
		{name: "empty secret", token: validToken, secret: "", wantErr: "secret is required"},
		{name: "expired", token: expiredToken, secret: secret, wantErr: "token has invalid claims"},
		{name: "invalid signature", token: validToken, secret: "wrong-secret", wantErr: "signature is invalid"},
		{name: "malformed", token: "not-a-jwt", secret: secret, wantErr: "parse token"},
		{name: "missing user claim", token: noUserToken, secret: secret, wantErr: "userId"},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			userID, err := VerifyToken(tc.token, tc.secret)
			if tc.expectNil {
				if err != nil {
					t.Fatalf("VerifyToken returned error: %v", err)
				}
				if userID != "valid-user" {
					t.Fatalf("unexpected userID: %s", userID)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
			if tc.wantErr != "" && !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error %q does not contain %q", err, tc.wantErr)
			}
		})
	}
}

func TestVerifyTokenRoundTrip(t *testing.T) {
	secret := "roundtrip-secret"
	ids := []string{"user-1", "another-user", strings.Repeat("z", 64)}

	for _, id := range ids {
		token, err := GenerateToken(id, secret, 1)
		if err != nil {
			t.Fatalf("GenerateToken failed for %q: %v", id, err)
		}
		got, err := VerifyToken(token, secret)
		if err != nil {
			t.Fatalf("VerifyToken failed for %q: %v", id, err)
		}
		if got != id {
			t.Fatalf("VerifyToken returned %q, want %q", got, id)
		}
	}
}

func signClaims(t *testing.T, claims Claims, secret string) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("signClaims failed: %v", err)
	}
	return signed
}
