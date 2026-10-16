<script setup lang="ts">
const route = useRoute();
useHead({ title: 'Page not found · TaskPilot' });
if (import.meta.server) {
  const event = useRequestEvent();
  if (event) setResponseStatus(event, 404, 'Not Found');
}
</script>

<template>
  <div class="page nf">
    <div class="card box">
      <p class="code">404</p>
      <h1 class="page-title">Page not found</h1>
      <p class="muted">
        Nothing lives at <code>{{ route.path }}</code>. It may have been moved, or the link is wrong.
      </p>
      <div class="links">
        <NuxtLink to="/dashboard" class="btn btn-primary">Go to dashboard</NuxtLink>
        <NuxtLink to="/tasks" class="btn">Browse tasks</NuxtLink>
      </div>
    </div>
  </div>
</template>

<style scoped>
.nf {
  display: grid;
  place-items: center;
  min-height: calc(100vh - var(--topbar-h));
}

.box {
  max-width: 460px;
  padding: 36px 32px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}

.code {
  font-size: 56px;
  font-weight: 800;
  letter-spacing: -0.04em;
  background: linear-gradient(135deg, #6366f1, #ec4899);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  line-height: 1;
}

code {
  font-family: var(--font-mono);
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 4px;
  word-break: break-all;
}

.links {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
  justify-content: center;
}
</style>
