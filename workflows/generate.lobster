name: vantly-ugc-ugc
args:
  script:
    default: ""
  actor:
    default: ""
  style:
    default: "hormozi"
  template:
    default: ""
steps:
  - id: check_credits
    command: vantly-ugc credits --json

  - id: list_actors
    command: vantly-ugc actor list --json

  - id: confirm_generation
    command: |
      echo "UGC Video Generation"
      echo "Script: ${script}"
      echo "Actor: ${actor:-auto-selected}"
      echo "Style: ${style}"
      echo "Template: ${template:-free-form}"
      echo "Ready to generate?"
    approval: required

  - id: generate
    command: vantly-ugc ugc "${script}" --actor ${actor} --style ${style} ${template:+--template ${template}} --sync --json
    condition: $confirm_generation.approved

  - id: download
    command: vantly-ugc download $generate.json.job_id --json
    condition: $confirm_generation.approved
