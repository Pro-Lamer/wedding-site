# MVP Event Tracking

Минимальный список событий для аналитики MVP.

## Auth
- `auth_register_started`
- `auth_register_completed`
- `auth_login_success`
- `auth_login_failed`
- `auth_email_verified`

## Company
- `company_inn_verify_requested`
- `company_inn_verify_succeeded`
- `company_profile_updated`
- `company_logo_uploaded`
- `company_contacts_unlocked`

## Posts
- `post_created`
- `post_updated`
- `post_hidden`
- `post_archived`
- `post_list_viewed`
- `post_opened`

## Responses
- `response_created`
- `response_viewed`
- `response_message_sent`

## Payments
- `payment_created`
- `payment_webhook_received`
- `payment_paid`
- `payment_failed`
- `subscription_activated`

## Moderation
- `report_created`
- `report_status_changed`
- `moderation_action_created`

## Payload guidelines
Во все события добавлять:
- `event_id` (uuid)
- `event_name`
- `occurred_at` (ISO timestamp)
- `actor_user_id` (nullable)
- `actor_company_id` (nullable)
- `correlation_id`
- `meta` (json)
