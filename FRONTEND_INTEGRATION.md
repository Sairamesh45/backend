# Frontend Integration Guide

Base URL:
- `http://localhost:3000`

Content types:
- JSON for most APIs
- `multipart/form-data` for `/submit` (because of image upload)

## 1) Submit User + Dog Details

Endpoint:
- `POST /submit`

Body (`multipart/form-data`):
- `name` (string, required)
- `phoneno` (string, required)
- `address` (string, required)
- `city` (string, required)
- `mail` (string, required)
- `dogsname` (string, required)
- `dogphoto` (file, required, jpg/png/webp, max 5MB)
- `referralCode` (string, optional)

Referral behavior:
- If `referralCode` is provided, backend validates it during submit.
- Invalid referral code => `400 Bad Request` with message `Invalid referral code.`

Success response:
- `201 Created`
- Returns saved submission in `data`
- Save `data._id` as `submissionId` for payment success API

Example:
```json
{
  "message": "Submission received successfully.",
  "data": {
    "_id": "67be1234abcd...",
    "name": "Arun T.",
    "city": "Delhi",
    "dogsname": "Zeus",
    "paymentStatus": "pending"
  }
}
```

## 2) Payment Success (After Razorpay success in frontend)

Endpoint:
- `POST /payment/success`

Body (`application/json`):
- `submissionId` (string, required)
- `razorpay_payment_id` (string, required)
- `razorpay_order_id` (string, optional)

What backend does:
- Verifies payment from Razorpay API
- Marks payment status
- Assigns cohort and position (`1-20` per cohort)
- Generates unique referral code for this user
- Sends payment confirmation email to this user
- If this user used a referral code:
  - Increments referrer's referral count
  - Sends referrer a "your referral was used" email

Success response:
```json
{
  "message": "Payment verified successfully.",
  "paymentStatus": "captured",
  "emailSent": true,
  "referralCreditedNow": true,
  "referrerTotalReferralCount": 3,
  "data": {
    "_id": "67be1234abcd...",
    "cohortNumber": 2,
    "cohortPosition": 1,
    "referralCode": "REFA1B2C3D4"
  }
}
```

## 3) Live Activity Feed

Endpoint:
- `GET /activity/live?limit=20`

Query params:
- `limit` (optional, default `20`, max `100`)

Returns latest paid users for ticker/activity section.

Response shape:
```json
{
  "message": "Live activity fetched successfully.",
  "data": [
    {
      "dogName": "Zeus",
      "parentName": "Arun T.",
      "city": "Delhi",
      "cohortNumber": 1,
      "position": 7,
      "claimedAt": "2026-02-25T16:05:00.000Z"
    }
  ]
}
```

## 4) Cohort-wise Dog List

Endpoint:
- `GET /cohorts`

Returns dogs grouped by cohort.

Response shape:
```json
{
  "message": "Cohorts fetched successfully.",
  "data": {
    "cohort 1": [
      {
        "dogName": "Bruno",
        "dogPhoto": "https://res.cloudinary.com/...",
        "position": 1
      }
    ],
    "cohort 2": []
  }
}
```

## 5) Spots/Progress Section

Endpoint:
- `GET /spots/status`

Use this for:
- `7 / 20` style progress
- `13 spots remaining`
- Current live cohort number
- Last spot claimed time

Response:
```json
{
  "message": "Spots status fetched successfully.",
  "data": {
    "currentCohortNumber": 1,
    "claimed": 7,
    "total": 20,
    "remaining": 13,
    "totalPaidOverall": 7,
    "lastClaimedAt": "2026-02-25T16:05:00.000Z"
  }
}
```

## 6) Health Check

Endpoint:
- `GET /health`

Response:
```json
{ "ok": true }
```

## 7) Referral Code Validation (Optional frontend pre-check)

Endpoint:
- `GET /referral/validate?code=REFXXXX`

Success response:
```json
{
  "message": "Referral code is valid.",
  "valid": true,
  "data": {
    "referrerName": "Arun T.",
    "referralCode": "REFABC12345",
    "referralUseCount": 5
  }
}
```

Invalid code response:
```json
{
  "message": "Invalid referral code.",
  "valid": false
}
```

## Frontend Flow (Recommended)

1. User fills form and uploads dog image.
2. Call `POST /submit`.
3. Store returned `submissionId`.
4. Open Razorpay checkout in frontend.
5. On Razorpay success callback, call `POST /payment/success` with `submissionId` + Razorpay payment id/order id.
6. Show returned cohort number/position/referral code in success UI.
7. Poll or fetch:
- `GET /spots/status` for progress bar + remaining spots
- `GET /activity/live` for "who joined" list
- `GET /cohorts` for cohort gallery

## Important Notes

- Cohort size is fixed at `20`.
- Position is cohort-based:
  - 20th payment in cohort 1 => position `20`
  - next payment => cohort 2 position `1`
- Dog photos are stored on Cloudinary, not local disk.
- Relative time text like "47 mins ago" should be generated in frontend from `claimedAt` / `lastClaimedAt`.
- Backend currently verifies payment by fetching from Razorpay API. Signature verification can be added as an extra hardening step.
