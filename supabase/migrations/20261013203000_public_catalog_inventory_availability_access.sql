-- Allow the owner-backed public catalog view to read the internal availability
-- view while keeping the internal view itself unavailable to anonymous clients.
alter view public.inventory_item_availability set (security_invoker = false);

grant select on public.inventory_item_availability to authenticated, service_role;

notify pgrst, 'reload schema';
