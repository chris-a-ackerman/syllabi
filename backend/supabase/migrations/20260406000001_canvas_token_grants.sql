-- Grant SELECT on profiles_safe view to authenticated users
-- Without this, frontend queries return no rows (Studio works because it uses the postgres role)
GRANT SELECT ON public.profiles_safe TO authenticated;
