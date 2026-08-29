name: vantly-ugc-batch-ugc
args:
  scripts:
    default: "[]"
  actor:
    default: ""
  style:
    default: "hormozi"
steps:
  - id: check_credits
    command: vantly-ugc credits --json

  - id: preview_batch
    command: |
      echo "Batch UGC Generation"
      echo "Actor: ${actor}"
      echo "Style: ${style}"
      echo "Scripts: ${scripts}"
    approval: required

  - id: submit_batch
    command: |
      for script in $(echo '${scripts}' | jq -r '.[]'); do
        vantly-ugc ugc "$script" --actor ${actor} --style ${style} --json
      done
    condition: $preview_batch.approved

  - id: list_results
    command: vantly-ugc list --status completed --limit 10 --json
    condition: $preview_batch.approved
