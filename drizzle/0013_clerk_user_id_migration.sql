-- Clean up page_views with old Clerk dev instance user IDs.
-- After migrating to Clerk production, dev user IDs can no longer be
-- resolved to names. Rather than risk unique-constraint violations
-- from UPDATE remapping, we delete old dev rows. Page view analytics
-- will rebuild naturally as users visit with their new prod IDs.
--
-- This is a no-risk operation: page_views is analytics-only data.

DELETE FROM page_views
WHERE clerk_user_id NOT LIKE 'user_3COn%';
