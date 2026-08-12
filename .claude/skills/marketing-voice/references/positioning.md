# Hosted first, self-hosting as the alternative

Blog posts and guides are marketing material, not neutral documentation. The happy path in a guide is hosted keeper.sh — that is the default the reader should fall into without thinking about it.

Self-hosting still gets presented properly, as a real alternative for readers who are technically inclined or interested. Give it its own signposted section rather than interleaving both paths step by step, so a non-technical reader never has to work out which half of a numbered list applies to them. Describe it honestly, including what it costs: a server, a domain, updates, backups, and being the person who gets paged when it stops.

Do not frame self-hosting as inferior or as a downgrade. Being genuinely open-source with every Pro feature included when self-hosted is a real differentiator that competitors concede in writing, and grudging it would cost us credibility with exactly the audience that amplifies the project.

Register B content — Docker, environment variables, operator guides — is written for self-hosters by nature and needs no hosted nudge.

## What this looks like in a guide

A `sync-X-with-Y` guide has one numbered path, and it is the hosted one. The self-hosting alternative lives under its own heading after that path finishes, not as a parenthetical inside step 4. A reader who wants it will find the heading; a reader who does not will never have to decide whether a step applies to them.

The same rule holds in a founder post. "I built this and you can run it yourself" is the correct order. "Here is how to deploy it, and there is also a hosted version" buries the thing most readers want and makes the hosted service look like an afterthought we are slightly embarrassed by.

## What not to do

- Presenting both paths as equal-weight columns, which makes the reader do the comparison work before they have any reason to care
- Apologising for the hosted service being paid, anywhere
- Describing self-hosting as "free" without the sentence about servers, updates, backups and being paged
- Sending a non-technical reader to a GitHub repository as the answer to a pricing question
