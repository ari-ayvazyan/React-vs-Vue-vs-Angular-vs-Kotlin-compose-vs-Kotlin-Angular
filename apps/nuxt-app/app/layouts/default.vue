<script setup lang="ts">
useShortcuts();
</script>

<template>
  <div class="shell">
    <a href="#main" class="skip">Skip to content</a>
    <AppSidebar />
    <div class="main-col">
      <AppTopbar />
      <main id="main" tabindex="-1" class="main">
        <slot />
      </main>
    </div>
    <TaskModal />
    <ShortcutHelp />
    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}

.main-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.main {
  flex: 1;
  min-width: 0;
}

.main:focus {
  outline: none;
}

.skip {
  position: absolute;
  left: 12px;
  top: -60px;
  z-index: 300;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--on-accent);
}

.skip:focus {
  top: 12px;
}
</style>
