<script lang="ts">
  import MonthCalendar from '../components/MonthCalendar.svelte';
</script>

<div class="page">
  <MonthCalendar maxPerDay={5} />
</div>

<style>
  .page {
    height: 100%;
    padding: 32px 40px;
  }
</style>
