const core = require('@actions/core')
const github = require('@actions/github')
const yaml = require('js-yaml')
const fs   = require('fs')
const fm = require('front-matter')

async function run() {
  try {
    const config = core.getInput('config')
    const ghToken = core.getInput('token')
    const octokit = github.getOctokit(ghToken)
    const context = github.context
    
    const configDoc = yaml.safeLoad(fs.readFileSync(config, 'utf8'));
    core.debug(`Loaded config ${JSON.stringify(configDoc)}`)

    const projectParams = {
        ...context.repo,
        name: configDoc.name
    }

    core.debug(`Creating "${configDoc.name}" project board in ${projectParams.owner}/${projectParams.repo}`)

    const { data: project } = await octokit.projects.createForRepo(projectParams)
    const projectId = project.id
    let previousColumnId 

    for (let index in configDoc.columns) {
      const columnName = configDoc.columns[index]
      core.debug(`Adding column ${columnName}`)

      const { data: column } = await octokit.projects.createColumn({
        project_id: projectId,
        name: columnName
      })

      let postion
      
      if (index == 0) {
        // We are adding the cards to the first column
        generateIssues(octokit, configDoc.folder, projectParams.owner, projectParams.repo, column.id)
        postion = 'first'
      } else {
        postion = `after:${previousColumnId}`
      }

      previousColumnId  = column.id

      // Colums are created in a random order. We need to sort them
      core.debug(`Moving column ${columnName} to position ${postion}`)
      
      octokit.projects.moveColumn({
        column_id: column.id,
        position: postion
      })
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

function generateIssues(octokit, folder, owner, repo, columnId) {
  var files = fs.readdirSync(folder)
  for (let file of files) {
    core.debug(`Loading test case file ${file}`)

    fs.readFile(`${folder}/${file}`, 'utf8', (err, rawFileContent) => {
      var content = fm(rawFileContent)
      core.debug(content)
      
      const issue = {
        owner: owner,
        repo: repo, 
        title: content.attributes.title,
        body: content.body,
      }

      if (content.attributes.assignees) {
        issue.assignees = content.attributes.assignees.split(',').map(s => s.trim())
      }

      if (content.attributes.labels) {
        issue.labels = content.attributes.labels.split(',').map(s => s.trim())
      }

      octokit.issues.create(issue).then(({ data: issue }) => {
        // Adding the issue to the project
        octokit.projects.createCard({
          column_id: columnId,
          content_id: issue.id,
          content_type: 'Issue'
        }).catch(cardError => {
          core.setFailed(`Failed to add the issue as a card: ${cardError.message}`)  
        })
      }).catch(issueError => {
        core.setFailed(`Failed creating the issue: ${issueError.message}`)
      })
    })
  }
}

run()
