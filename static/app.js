let tasks = [];
let selectedTask = null;
let currentDetailTask = null;
let pendingStatusUpdate = null;
let parentTasksList = [];
let dependencyTasksList = [];
let currentMode = 'graph';
let currentFilter = 'my';
let currentSimulation = null;
let svg = null;
let g = null;

const current_user_role = document.body.dataset.userRole || 'developer';
const current_user_id = parseInt(document.body.dataset.userId) || 0;

const statusColors = {
    'not_started': '#555',
    'started': '#ffd54f',
    'functional': '#ff9800',
    'documented': '#2196f3',
    'integrated': '#4caf50'
};

const statusLabels = {
    'not_started': 'Not Started',
    'started': 'Started',
    'functional': 'Functional',
    'documented': 'Documented',
    'integrated': 'Integrated'
};

document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadTasks();
});

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentMode = e.target.dataset.mode;
            switchMode(currentMode);
        });
    });

    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.filter;
            renderTaskList();
        });
    });

    // Task search
    document.getElementById('taskSearchInput').addEventListener('input', (e) => {
        renderTaskList(e.target.value);
    });

    //close context menu on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) {
            document.getElementById('contextMenu').style.display = 'none';
        }
    });

    //close dependency search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.dependency-search-container')) {
            document.querySelectorAll('.dependency-search-results').forEach(el => {
                el.classList.remove('active');
            });
        }
    });
}

function switchMode(mode) {
    document.getElementById('treeView').classList.remove('active');
    document.getElementById('graphView').classList.remove('active');
    
    if (mode === 'tree') {
        document.getElementById('treeView').classList.add('active');
        renderTree();
    } else {
        document.getElementById('graphView').classList.add('active');
        if (selectedTask) {
            renderGraph(selectedTask);
        }
    }
}

async function loadTasks() {
    const resp = await fetch('/api/tasks');
    tasks = await resp.json();
    
    tasks.forEach(task => {
        if (!task.parent_ids) task.parent_ids = [];
        if (!task.child_ids) task.child_ids = [];
        if (!task.assignee_id) task.assignee_id = null;
    });
    
    const emptyState = document.getElementById('emptyState');
    if (tasks.length === 0) {
        emptyState.classList.add('active');
    } else {
        emptyState.classList.remove('active');
    }
    
    renderTaskList();
    
    if (currentMode === 'tree') {
        renderTree();
    } else if (selectedTask) {
        renderGraph(selectedTask);
    }
}

function renderTaskList(searchQuery = '') {
    const taskList = document.getElementById('taskList');
    taskList.innerHTML = '';
    
    let filteredTasks = [...tasks];
    
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filteredTasks = filteredTasks.filter(t => 
            t.title.toLowerCase().includes(query) || 
            (t.description && t.description.toLowerCase().includes(query))
        );
    }
    
    const statusPriority = {
        'started': 0,
        'functional': 1, 
        'documented': 2,
        'integrated': 3,
        'not_started': 4
    };
    
    filteredTasks.sort((a, b) => {
        const aIsMine = a.assignee_id === current_user_id;
        const bIsMine = b.assignee_id === current_user_id;
        
        if (aIsMine && !bIsMine) return -1;
        if (!aIsMine && bIsMine) return 1;
        
        const aIsUnassigned = !a.assignee_id;
        const bIsUnassigned = !b.assignee_id;
        
        if (aIsUnassigned && !bIsUnassigned) return -1;
        if (!aIsUnassigned && bIsUnassigned) return 1;
        
        if ((aIsMine && bIsMine) || (aIsUnassigned && bIsUnassigned)) {
            const aPriority = statusPriority[a.status] ?? 5;
            const bPriority = statusPriority[b.status] ?? 5;
            return aPriority - bPriority;
        }
        
        const aPriority = statusPriority[a.status] ?? 5;
        const bPriority = statusPriority[b.status] ?? 5;
        return aPriority - bPriority;
    });
    
    filteredTasks.forEach(task => {
        const item = document.createElement('div');
        item.className = 'task-list-item';
        
        if (task.id === selectedTask) {
            item.classList.add('selected');
        }
        
        if (task.next_status_highlight) {
            item.classList.add(`highlight-${task.next_status_highlight}`);
        }
        
        const ownerText = task.assignee ? task.assignee : 'Unassigned';
        const showTakeBtn = !task.assignee && task.status === 'not_started';
        const showAbandonBtn = task.assignee_id === current_user_id && task.status !== 'integrated';
        
        item.innerHTML = `
            <div class="task-list-item-header">
                <div class="task-list-item-title">${task.title}</div>
                <div class="task-list-item-owner">${ownerText}</div>
            </div>
            ${task.description ? `<div class="task-list-item-desc">${task.description}</div>` : ''}
            <div class="task-list-item-footer">
                <span class="status-badge status-${task.status}">${statusLabels[task.status]}</span>
                <div>
                    ${showTakeBtn ? '<button class="take-btn" onclick="event.stopPropagation(); confirmTakeTask(' + task.id + ')">Take</button>' : ''}
                    ${showAbandonBtn ? '<button class="take-btn" style="background: var(--danger); margin-left: 4px;" onclick="event.stopPropagation(); abandonTask(' + task.id + ')">Abandon</button>' : ''}
                </div>
            </div>
        `;
        
        item.addEventListener('click', () => {
            selectTaskFromList(task.id);
        });
        
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            selectTaskFromList(task.id);
            showContextMenu(e.pageX, e.pageY);
        });
        
        taskList.appendChild(item);
    });
    
    console.log('Sorted tasks:', filteredTasks.map(t => ({
        id: t.id,
        title: t.title,
        assignee: t.assignee,
        status: t.status,
        isMine: t.assignee_id === current_user_id,
        isUnassigned: !t.assignee_id
    })));
}

async function confirmTakeTask(taskId) {
    if (!confirm('Are you sure you want to take this task?')) return;
    await takeTask(taskId);
}

async function takeTask(taskId) {
    const resp = await fetch(`/api/task/${taskId}/request`, { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
        showFlash('Task claimed', 'success');
        await loadTasks();
    } else {
        showFlash(data.message, 'error');
    }
}

async function abandonTask(taskId) {
    if (!confirm('Are you sure you want to abandon this task?')) return;
    
    const resp = await fetch(`/api/task/${taskId}/unassign`, { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
        showFlash('Task abandoned', 'success');
        await loadTasks();
        if (selectedTask === taskId) {
            await viewTaskDetails();
        }
    } else {
        showFlash(data.message, 'error');
    }
}

function selectTaskFromList(taskId) {
    selectedTask = taskId;
    renderTaskList();
    
    viewTaskDetails();
    
    if (currentMode === 'graph') {
        renderGraph(taskId);
    } else {
        updateTreeSelection();
    }
}

async function takeTask(taskId) {
    const resp = await fetch(`/api/task/${taskId}/request`, { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
        showFlash('Task claimed', 'success');
        await loadTasks();
    } else {
        showFlash(data.message, 'error');
    }
}

function renderGraph(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    const container = document.getElementById('graphContainer');
    container.innerHTML = '';
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '1';
    container.appendChild(svg);
    
    const levels = [];
    const taskToLevel = new Map();
    
    function calculateLevels(currentTask, currentLevel) {
        if (taskToLevel.has(currentTask.id)) {
            if (currentLevel > taskToLevel.get(currentTask.id)) {
                taskToLevel.set(currentTask.id, currentLevel);
            }
        } else {
            taskToLevel.set(currentTask.id, currentLevel);
        }
        
        if (currentTask.parent_ids) {
            currentTask.parent_ids.forEach(parentId => {
                const parentTask = tasks.find(t => t.id === parentId);
                if (parentTask) {
                    calculateLevels(parentTask, currentLevel + 1);
                }
            });
        }
    }
    
    calculateLevels(task, 0);
    
    const maxDepth = Math.max(...Array.from(taskToLevel.values()));
    for (let i = 0; i <= maxDepth; i++) {
        levels.push([]);
    }
    
    taskToLevel.forEach((level, taskId) => {
        const task = tasks.find(t => t.id === taskId);
        if (task) {
            levels[level].push(task);
        }
    });
    
    levels.forEach((level, levelIndex) => {
        const levelDiv = document.createElement('div');
        levelDiv.className = 'graph-level';
        levelDiv.setAttribute('data-level', levelIndex);
        
        level.forEach(t => {
            const node = createGraphNode(t);
            levelDiv.appendChild(node);
        });
        
        container.appendChild(levelDiv);
    });
    
    setTimeout(() => drawSVGConnections(levels, taskToLevel, svg), 50);
}

function drawSVGConnections(levels, taskToLevel, svg) {
    svg.innerHTML = '';
    
    for (let i = 0; i < levels.length - 1; i++) {
        const currentLevel = levels[i];
        const nextLevel = levels[i + 1];
        
        currentLevel.forEach(childTask => {
            if (childTask.parent_ids) {
                childTask.parent_ids.forEach(parentId => {
                    const parentLevel = taskToLevel.get(parentId);
                    if (parentLevel === i + 1) {
                        const parentTask = levels[parentLevel].find(t => t.id === parentId);
                        if (parentTask) {
                            drawSVGConnection(childTask.id, parentTask.id, svg);
                        }
                    }
                });
            }
        });
    }
}

function drawSVGConnection(childId, parentId, svg) {
    const childEl = document.querySelector(`[data-task-id="${childId}"]`);
    const parentEl = document.querySelector(`[data-task-id="${parentId}"]`);
    
    if (!childEl || !parentEl) return;
    
    const childRect = childEl.getBoundingClientRect();
    const parentRect = parentEl.getBoundingClientRect();
    const containerRect = svg.getBoundingClientRect();
    
    const childX = childRect.left + childRect.width / 2 - containerRect.left;
    const childY = childRect.bottom - containerRect.top;
    const parentX = parentRect.left + parentRect.width / 2 - containerRect.left;
    const parentY = parentRect.top - containerRect.top;
    
    if (parentY > childY) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', childX);
        line.setAttribute('y1', childY);
        line.setAttribute('x2', parentX);
        line.setAttribute('y2', parentY);
        line.setAttribute('stroke', 'var(--border)');
        line.setAttribute('stroke-width', '2');
        line.setAttribute('marker-end', 'url(#arrowhead)');
        
        svg.appendChild(line);
    }
}

function addGraphConnections(levels, taskToLevel) {
    const container = document.getElementById('graphContainer');
    
    container.querySelectorAll('.graph-connection-line, .graph-connection-horizontal').forEach(el => el.remove());
    
    for (let i = 0; i < levels.length - 1; i++) {
        const currentLevel = levels[i];
        const nextLevel = levels[i + 1];
        
        currentLevel.forEach(childTask => {
            if (childTask.parent_ids) {
                childTask.parent_ids.forEach(parentId => {
                    const parentLevel = taskToLevel.get(parentId);
                    if (parentLevel === i + 1) {
                        const parentTask = levels[parentLevel].find(t => t.id === parentId);
                        if (parentTask) {
                            createConnection(childTask.id, parentTask.id);
                        }
                    }
                });
            }
        });
    }
}

function createConnection(childId, parentId) {
    const childEl = document.querySelector(`[data-task-id="${childId}"]`);
    const parentEl = document.querySelector(`[data-task-id="${parentId}"]`);
    
    if (!childEl || !parentEl) return;
    
    const container = document.getElementById('graphContainer');
    
    const childRect = childEl.getBoundingClientRect();
    const parentRect = parentEl.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    const childX = childRect.left + childRect.width / 2 - containerRect.left;
    const childY = childRect.bottom - containerRect.top;
    const parentX = parentRect.left + parentRect.width / 2 - containerRect.left;
    const parentY = parentRect.top - containerRect.top;
    
    if (parentY > childY) {
        const line = document.createElement('div');
        line.className = 'graph-connection-line';
        
        line.style.left = childX + 'px';
        line.style.top = childY + 'px';
        line.style.height = (parentY - childY) + 'px';
        
        container.appendChild(line);
    }
}

function createGraphNode(task) {
    const node = document.createElement('div');
    node.className = 'graph-node';
    node.style.borderColor = statusColors[task.status];
    node.setAttribute('data-task-id', task.id);
    
    if (task.id === selectedTask) {
        node.classList.add('selected');
    }
    
    const ownerText = task.assignee ? task.assignee : 'Unassigned';
    
    node.innerHTML = `
        <div class="graph-node-title">${task.title}</div>
        <div class="graph-node-owner">${ownerText}</div>
        <span class="status-badge status-${task.status}">${statusLabels[task.status]}</span>
    `;
    
    node.addEventListener('click', (e) => {
        e.stopPropagation();
        selectTaskFromList(task.id);
        viewTaskDetails();
    });
    
    node.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectTaskFromList(task.id);
        showContextMenu(e.pageX, e.pageY);
    });
    
    return node;
}

function renderTree() {
    if (!svg) {
        svg = d3.select('#treeCanvas');
        svg.selectAll('*').remove();
        g = svg.append('g');
    } else {
        g.selectAll('*').remove();
    }

    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;

    if (!svg.on('zoom')) {
        const zoom = d3.zoom()
            .scaleExtent([0.1, 3])
            .on('zoom', (event) => {
                g.attr('transform', event.transform);
            });
        svg.call(zoom);
    }

    const nodes = [];
    const links = [];

    tasks.forEach(task => {
        nodes.push({
            id: task.id,
            title: task.title,
            status: task.status,
            progress: task.progress,
            parentCount: task.parent_ids ? task.parent_ids.length : 0,
            nextStatusHighlight: task.next_status_highlight,
            childrenCount: task.child_ids ? task.child_ids.length : 0
        });
    });

    tasks.forEach(task => {
        if (task.parent_ids) {
            task.parent_ids.forEach(parentId => {
                links.push({
                    source: parentId,
                    target: task.id
                });
            });
        }
    });

    if (currentSimulation) {
        currentSimulation.stop();
    }

    currentSimulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(links).id(d => d.id).distance(120))
        .force('charge', d3.forceManyBody().strength(-800))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(50));

    if (!svg.select('defs #arrowhead').node()) {
        svg.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 32)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', '#3a3a3a');
    }

    const link = g.append('g')
        .selectAll('line')
        .data(links)
        .enter().append('line')
        .attr('stroke', '#3a3a3a')
        .attr('stroke-width', 2)
        .attr('marker-end', 'url(#arrowhead)');

    const node = g.append('g')
        .selectAll('g')
        .data(nodes)
        .enter().append('g')
        .attr('class', 'node')
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
            event.stopPropagation();
            selectTaskFromList(d.id);
            viewTaskDetails();
        })
        .on('contextmenu', (event, d) => {
            event.preventDefault();
            selectTaskFromList(d.id);
            showContextMenu(event.pageX, event.pageY);
        })
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));

    node.each(function(d) {
        const nodeGroup = d3.select(this);
        const baseRadius = 30;
        const childBonus = Math.min(d.childrenCount * 3, 15);
        const nodeRadius = baseRadius + childBonus;
        
        if (d.nextStatusHighlight) {
            nodeGroup.append('circle')
                .attr('r', nodeRadius + 3)
                .attr('fill', 'none')
                .attr('stroke', statusColors[d.nextStatusHighlight])
                .attr('stroke-width', 3)
                .style('stroke-dasharray', '5,5')
                .style('animation', 'pulse 2s infinite');
        }

        if (selectedTask === d.id) {
            nodeGroup.append('circle')
                .attr('r', nodeRadius + 2)
                .attr('fill', 'none')
                .attr('stroke', 'white')
                .attr('stroke-width', 2);
        }

        nodeGroup.append('circle')
            .attr('r', nodeRadius)
            .attr('fill', statusColors[d.status])
            .attr('stroke', '#1a1a1a')
            .attr('stroke-width', 2);

        const text = nodeGroup.append('text')
            .attr('text-anchor', 'middle')
            .attr('dy', '0.35em')
            .attr('fill', d.status === 'started' ? '#000' : '#fff')
            .attr('font-size', nodeRadius > 35 ? '13px' : '12px')
            .attr('font-weight', 'bold');

        const words = d.title.split(' ');
        let line = '';
        let lineNumber = 0;
        const lineHeight = 1.1;
        const maxWidth = nodeRadius * 1.4;

        words.forEach((word, i) => {
            const testLine = line + word + ' ';
            const testWidth = testLine.length * (nodeRadius > 35 ? 7 : 6);
            
            if (testWidth > maxWidth && i > 0) {
                text.append('tspan')
                    .attr('x', 0)
                    .attr('dy', lineNumber === 0 ? '-0.3em' : `${lineHeight}em`)
                    .text(line.trim());
                line = word + ' ';
                lineNumber++;
            } else {
                line = testLine;
            }
        });

        if (line) {
            text.append('tspan')
                .attr('x', 0)
                .attr('dy', lineNumber === 0 ? 0 : `${lineHeight}em`)
                .text(line.trim());
        }

        if (d.progress > 0 && d.progress < 100) {
            nodeGroup.append('text')
                .attr('y', nodeRadius + 15)
                .attr('text-anchor', 'middle')
                .attr('fill', '#999')
                .attr('font-size', '11px')
                .text(`${d.progress}%`);
        }
    });

    currentSimulation.on('tick', () => {
        link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        node.attr('transform', d => `translate(${d.x}, ${d.y})`);
    });

    function dragstarted(event, d) {
        if (!event.active) currentSimulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) currentSimulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    if (!window.initialZoomDone) {
        setTimeout(() => {
            const bbox = g.node().getBBox();
            const scale = Math.min(width / bbox.width, height / bbox.height, 1) * 0.8;
            const translateX = (width - bbox.width * scale) / 2 - bbox.x * scale;
            const translateY = (height - bbox.height * scale) / 2 - bbox.y * scale;
            svg.call(svg.on('zoom').transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
            window.initialZoomDone = true;
        }, 500);
    }
}

function updateTreeSelection() {
    if (currentMode !== 'tree' || !g) return;
    
    g.selectAll('.node').each(function(d) {
        const nodeGroup = d3.select(this);
        nodeGroup.selectAll('circle').filter(function() {
            return d3.select(this).attr('stroke') === 'white' && d3.select(this).attr('fill') === 'none';
        }).remove();
        
        if (d.id === selectedTask) {
            const baseRadius = 30;
            const childBonus = Math.min(d.childrenCount * 3, 15);
            const nodeRadius = baseRadius + childBonus;
            
            nodeGroup.append('circle')
                .attr('r', nodeRadius + 2)
                .attr('fill', 'none')
                .attr('stroke', 'white')
                .attr('stroke-width', 2)
                .lower();
        }
    });
}

function showContextMenu(x, y) {
    const menu = document.getElementById('contextMenu');
    menu.style.display = 'block';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
}

async function viewTaskDetails() {
    const resp = await fetch(`/api/task/${selectedTask}`);
    const task = await resp.json();
    currentDetailTask = task;

    document.getElementById('detailTitle').textContent = task.title;
    document.getElementById('detailDescription').textContent = task.description || 'No description';

    const statusSelector = document.getElementById('statusSelector');
    statusSelector.innerHTML = '';
    Object.keys(statusLabels).forEach(status => {
        const btn = document.createElement('button');
        btn.className = `status-btn status-${status} ${task.status === status ? 'active' : ''}`;
        btn.textContent = statusLabels[status];
        btn.style.background = statusColors[status];
        btn.style.color = status === 'started' ? '#000' : '#fff';
        btn.onclick = () => updateTaskStatus(status);
        statusSelector.appendChild(btn);
    });

    const assignmentInfo = document.getElementById('assignmentInfo');
    const assignBtn = document.getElementById('assignBtn');
    const unassignBtn = document.getElementById('unassignBtn');
    
    assignBtn.style.display = 'none';
    unassignBtn.style.display = 'none';
    
    if (task.assignee) {
        assignmentInfo.textContent = `Assigned to: ${task.assignee}`;
        
        if (task.assignee_id === current_user_id && task.status !== 'integrated') {
            unassignBtn.textContent = 'Abandon Task';
            unassignBtn.style.display = 'block';
        } 
        else if (current_user_role === 'admin' || task.creator_id === current_user_id) {
            unassignBtn.textContent = 'Unassign';
            unassignBtn.style.display = 'block';
        }
        
        assignBtn.style.display = 'none';
    } else {
        assignmentInfo.innerHTML = '<span style="color: var(--text-dim);">Unassigned</span>';
        
        if (current_user_role === 'admin' || task.creator_id === current_user_id) {
            assignBtn.style.display = 'block';
        }
        
        unassignBtn.style.display = 'none';
    }

    const parentsList = document.getElementById('parentsList');
    parentsList.innerHTML = '';
    
    if (task.parent_ids && task.parent_ids.length > 0) {
        task.parent_ids.forEach(parentId => {
            const parentTask = tasks.find(t => t.id === parentId);
            if (parentTask) {
                const item = document.createElement('div');
                item.className = 'relationship-item';
                item.innerHTML = `
                    <span>${parentTask.title}</span>
                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="removeParent(${parentId})">Remove</button>
                `;
                parentsList.appendChild(item);
            }
        });
    } else {
        parentsList.innerHTML = '<span style="color: var(--text-dim);">No parents (root task)</span>';
    }

    const childrenList = document.getElementById('childrenList');
    childrenList.innerHTML = '';
    
    if (task.child_ids && task.child_ids.length > 0) {
        task.child_ids.forEach(childId => {
            const childTask = tasks.find(t => t.id === childId);
            if (childTask) {
                const item = document.createElement('div');
                item.className = 'relationship-item';
                item.innerHTML = `<span>${childTask.title}</span>`;
                childrenList.appendChild(item);
            }
        });
    } else {
        childrenList.innerHTML = '<span style="color: var(--text-dim);">No dependencies</span>';
    }

    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';
    if (task.history && task.history.length > 0) {
        task.history.reverse().forEach(h => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <div><strong>${statusLabels[h.old_status]}</strong> → <strong>${statusLabels[h.new_status]}</strong></div>
                <div class="time">${h.user} • ${new Date(h.timestamp).toLocaleString()}</div>
            `;
            historyList.appendChild(item);
        });
    } else {
        historyList.innerHTML = '<span style="color: var(--text-dim);">No history yet</span>';
    }

    document.getElementById('taskDetailPanel').classList.add('active');
    
    console.log('Assignment debug:', {
        taskId: task.id,
        assignee_id: task.assignee_id,
        current_user_id: current_user_id,
        isMine: task.assignee_id === current_user_id,
        status: task.status,
        showAbandon: (task.assignee_id === current_user_id && task.status !== 'integrated'),
        showUnassign: (current_user_role === 'admin' || task.creator_id === current_user_id)
    });
}

function closeDetailPanel() {
    document.getElementById('taskDetailPanel').classList.remove('active');
}

async function updateTaskStatus(newStatus) {
    const resp = await fetch(`/api/task/${currentDetailTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
    });
    const data = await resp.json();
    
    if (data.warning) {
        pendingStatusUpdate = { taskId: currentDetailTask.id, status: newStatus };
        showWarningModal(data.message);
    } else if (data.success) {
        showFlash('Status updated', 'success');
        await loadTasks();
        await viewTaskDetails();
    } else {
        showFlash(data.message, 'error');
    }
}

function showWarningModal(message) {
    document.getElementById('warningMessage').textContent = message;
    document.getElementById('warningModal').classList.add('active');
}

function closeWarningModal() {
    document.getElementById('warningModal').classList.remove('active');
    pendingStatusUpdate = null;
}

async function confirmWarningAction() {
    if (!pendingStatusUpdate) return;
    
    const resp = await fetch(`/api/task/${pendingStatusUpdate.taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            status: pendingStatusUpdate.status,
            override_warning: true
        })
    });
    const data = await resp.json();
    
    closeWarningModal();
    
    if (data.success) {
        showFlash('Status updated', 'success');
        await loadTasks();
        await viewTaskDetails();
    } else {
        showFlash(data.message, 'error');
    }
}

function showDocumentationModal() {
    fetch(`/api/task/${selectedTask}`)
        .then(resp => resp.json())
        .then(task => {
            currentDetailTask = task;
            document.getElementById('docEditor').value = task.documentation || '';
            document.getElementById('docModal').classList.add('active');
        });
}

function closeDocumentationModal() {
    document.getElementById('docModal').classList.remove('active');
}

async function saveDocumentation() {
    const content = document.getElementById('docEditor').value;
    const resp = await fetch(`/api/task/${currentDetailTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentation: content })
    });
    const data = await resp.json();
    if (data.success) {
        showFlash('Documentation saved', 'success');
        closeDocumentationModal();
    } else {
        showFlash(data.message, 'error');
    }
}

function showCreateTaskModal() {
    document.getElementById('taskModalTitle').textContent = 'Create Task';
    document.getElementById('taskId').value = '';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';
    document.getElementById('taskModal').classList.add('active');
}

function showAddChildModal() {
    document.getElementById('taskModalTitle').textContent = 'Create Child Task';
    document.getElementById('taskId').value = '';
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskDescription').value = '';
    window.pendingChildParent = selectedTask;
    document.getElementById('taskModal').classList.add('active');
}

function showEditTaskModal() {
    const task = tasks.find(t => t.id === selectedTask);
    document.getElementById('taskModalTitle').textContent = 'Edit Task';
    document.getElementById('taskId').value = task.id;
    document.getElementById('taskTitle').value = task.title;
    document.getElementById('taskDescription').value = task.description;
    document.getElementById('taskModal').classList.add('active');
}

function closeTaskModal() {
    document.getElementById('taskModal').classList.remove('active');
    window.pendingChildParent = null;
}

async function saveTask(e) {
    e.preventDefault();
    const taskId = document.getElementById('taskId').value;
    const title = document.getElementById('taskTitle').value;
    const description = document.getElementById('taskDescription').value;

    const data = { title, description };

    if (!taskId && window.pendingChildParent) {
        data.parent_ids = [window.pendingChildParent];
    }

    let resp;
    if (taskId) {
        resp = await fetch(`/api/task/${taskId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    } else {
        resp = await fetch('/api/task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }

    const result = await resp.json();
    if (result.success) {
        showFlash(taskId ? 'Task updated' : 'Task created', 'success');
        closeTaskModal();
        await loadTasks();
    } else {
        showFlash(result.message, 'error');
    }
}

async function deleteTask() {
    if (!confirm('Delete this task?')) return;
    
    const resp = await fetch(`/api/task/${selectedTask}`, { method: 'DELETE' });
    const data = await resp.json();
    if (data.success) {
        showFlash('Task deleted', 'success');
        closeDetailPanel();
        selectedTask = null;
        await loadTasks();
    } else {
        showFlash(data.message, 'error');
    }
}

async function requestTask() {
    const resp = await fetch(`/api/task/${selectedTask}/request`, { method: 'POST' });
    const data = await resp.json();
    if (data.success) {
        showFlash('Task claimed', 'success');
        await loadTasks();
        await viewTaskDetails();
    } else {
        showFlash(data.message, 'error');
    }
}

function showAddParentModal() {
    parentTasksList = tasks.filter(t => t.id !== currentDetailTask.id);
    document.getElementById('parentSearchInput').value = '';
    document.getElementById('parentTarget').value = '';
    document.getElementById('parentSearchResults').innerHTML = '';
    document.getElementById('parentModal').classList.add('active');
}

function closeParentModal() {
    document.getElementById('parentModal').classList.remove('active');
}

function filterParentTasks() {
    const query = document.getElementById('parentSearchInput').value.toLowerCase();
    const resultsDiv = document.getElementById('parentSearchResults');
    
    if (!query) {
        resultsDiv.classList.remove('active');
        return;
    }

    const filtered = parentTasksList.filter(t => 
        t.title.toLowerCase().includes(query) || 
        (t.description && t.description.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
        resultsDiv.innerHTML = '<div class="dependency-search-item" style="color: var(--text-dim);">No tasks found</div>';
    } else {
        resultsDiv.innerHTML = filtered.map(t => `
            <div class="dependency-search-item" data-id="${t.id}">
                <div style="font-weight: bold;">${t.title}</div>
                <div style="font-size: 11px; color: var(--text-dim);">${t.description ? t.description.substring(0, 60) + '...' : 'No description'}</div>
            </div>
        `).join('');
        
        resultsDiv.querySelectorAll('.dependency-search-item').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('parentTarget').value = item.dataset.id;
                document.getElementById('parentSearchInput').value = item.querySelector('div:first-child').textContent;
                resultsDiv.classList.remove('active');
            });
        });
    }
    
    resultsDiv.classList.add('active');
}

async function addParent(e) {
    e.preventDefault();
    const parentId = document.getElementById('parentTarget').value;
    
    if (!parentId) {
        showFlash('Please select a parent task', 'error');
        return;
    }

    const resp = await fetch(`/api/task/${currentDetailTask.id}/parents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_id: parseInt(parentId) })
    });
    
    const data = await resp.json();
    if (data.success) {
        showFlash('Parent added', 'success');
        closeParentModal();
        await loadTasks();
        await viewTaskDetails();
    } else {
        showFlash(data.message, 'error');
    }
}

function showAddDependencyModal() {
    dependencyTasksList = tasks.filter(t => t.id !== currentDetailTask.id);
    document.getElementById('dependencySearchInput').value = '';
    document.getElementById('dependencyTarget').value = '';
    document.getElementById('dependencySearchResults').innerHTML = '';
    document.getElementById('dependencyModal').classList.add('active');
}

function closeDependencyModal() {
    document.getElementById('dependencyModal').classList.remove('active');
}

function filterDependencyTasks() {
    const query = document.getElementById('dependencySearchInput').value.toLowerCase();
    const resultsDiv = document.getElementById('dependencySearchResults');
    
    if (!query) {
        resultsDiv.classList.remove('active');
        return;
    }

    const filtered = dependencyTasksList.filter(t => 
        t.title.toLowerCase().includes(query) || 
        (t.description && t.description.toLowerCase().includes(query))
    );

    if (filtered.length === 0) {
        resultsDiv.innerHTML = '<div class="dependency-search-item" style="color: var(--text-dim);">No tasks found</div>';
    } else {
        resultsDiv.innerHTML = filtered.map(t => `
            <div class="dependency-search-item" data-id="${t.id}">
                <div style="font-weight: bold;">${t.title}</div>
                <div style="font-size: 11px; color: var(--text-dim);">${t.description ? t.description.substring(0, 60) + '...' : 'No description'}</div>
            </div>
        `).join('');
        
        resultsDiv.querySelectorAll('.dependency-search-item').forEach(item => {
            item.addEventListener('click', () => {
                document.getElementById('dependencyTarget').value = item.dataset.id;
                document.getElementById('dependencySearchInput').value = item.querySelector('div:first-child').textContent;
                resultsDiv.classList.remove('active');
            });
        });
    }
    
    resultsDiv.classList.add('active');
}

async function addDependency(e) {
    e.preventDefault();
    const childId = document.getElementById('dependencyTarget').value;
    
    if (!childId) {
        showFlash('Please select a task to add as dependency', 'error');
        return;
    }

    const resp = await fetch(`/api/task/${currentDetailTask.id}/children`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ child_id: parseInt(childId) })
    });
    
    const data = await resp.json();
    if (data.success) {
        showFlash('Dependency added', 'success');
        closeDependencyModal();
        await loadTasks();
        await viewTaskDetails();
    } else {
        showFlash(data.message, 'error');
    }
}

async function removeParent(parentId) {
    if (!confirm('Remove this parent relationship?')) return;
    
    const resp = await fetch(`/api/task/${currentDetailTask.id}/parents/${parentId}`, {
        method: 'DELETE'
    });
    
    const data = await resp.json();
    if (data.success) {
        showFlash('Parent removed', 'success');
        await loadTasks();
        await viewTaskDetails();
    } else {
        showFlash(data.message, 'error');
    }
}

function showAssignTaskModal() {
    document.getElementById('assignTaskId').value = currentDetailTask.id;
    populateUserSelect();
    document.getElementById('assignTaskModal').classList.add('active');
}

function closeAssignTaskModal() {
    document.getElementById('assignTaskModal').classList.remove('active');
}

async function populateUserSelect() {
    const select = document.getElementById('assignUserSelect');
    select.innerHTML = '<option value="">Unassigned</option>';
    
    const resp = await fetch('/api/users');
    const users = await resp.json();
    
    users.forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = `${user.username} (${user.role})`;
        if (currentDetailTask.assignee_id === user.id) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function assignTaskToUser(e) {
    e.preventDefault();
    const taskId = document.getElementById('assignTaskId').value;
    const userId = document.getElementById('assignUserSelect').value;
    
    const resp = await fetch(`/api/task/${taskId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId ? parseInt(userId) : null })
    });
    
    const data = await resp.json();
    if (data.success) {
        showFlash('Task assigned', 'success');
        closeAssignTaskModal();
        await loadTasks();
        await viewTaskDetails();
    } else {
        showFlash(data.message, 'error');
    }
}

async function unassignTask() {
    if (!currentDetailTask) return;
    
    const task = tasks.find(t => t.id === currentDetailTask.id);
    if (!task) return;
    
    const isAbandon = task.assignee_id === current_user_id;
    const actionName = isAbandon ? 'abandon' : 'unassign';
    
    if (!confirm(`Are you sure you want to ${actionName} this task?`)) return;
    
    const resp = await fetch(`/api/task/${currentDetailTask.id}/unassign`, {
        method: 'POST'
    });
    
    const data = await resp.json();
    if (data.success) {
        showFlash(`Task ${actionName}ed successfully`, 'success');
        await loadTasks();
        await viewTaskDetails();
    } else {
        showFlash(data.message, 'error');
    }
}

function showUserManagementModal() {
    loadUsers();
    document.getElementById('userManagementModal').classList.add('active');
}

function closeUserManagementModal() {
    document.getElementById('userManagementModal').classList.remove('active');
}

let currentUsers = [];

async function loadUsers() {
    const resp = await fetch('/api/users');
    currentUsers = await resp.json();
    
    const usersList = document.getElementById('usersList');
    usersList.innerHTML = '';
    
    currentUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';
        item.innerHTML = `
            <div class="user-info">
                <div class="user-username">${user.username}</div>
                <div class="user-stats">
                    Created: ${user.created_tasks_count} tasks, Assigned: ${user.assigned_tasks_count} tasks
                </div>
            </div>
            <div class="user-actions">
                <span class="user-role ${user.role}">${user.role}</span>
                <button class="btn btn-secondary" onclick="editUser(${user.id})">Edit</button>
            </div>
        `;
        usersList.appendChild(item);
    });
}

function editUser(userId) {
    const user = currentUsers.find(u => u.id === userId);
    if (!user) return;
    
    document.getElementById('editUserId').value = user.id;
    document.getElementById('editUsername').value = user.username;
    document.getElementById('editUserRole').value = user.role;
    document.getElementById('editUserModal').classList.add('active');
}

function closeEditUserModal() {
    document.getElementById('editUserModal').classList.remove('active');
}

async function updateUser(e) {
    e.preventDefault();
    const userId = document.getElementById('editUserId').value;
    const username = document.getElementById('editUsername').value.trim();
    const role = document.getElementById('editUserRole').value;
    
    if (!userId) {
        showFlash('No user selected', 'error');
        return;
    }
    
    const resp = await fetch(`/api/user/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, role })
    });
    
    const data = await resp.json();
    if (data.success) {
        showFlash('User updated successfully', 'success');
        closeEditUserModal();
        await loadUsers();
    } else {
        showFlash(data.message, 'error');
    }
}

async function deleteUser() {
    const userId = document.getElementById('editUserId').value;
    
    if (!userId) {
        showFlash('No user selected', 'error');
        return;
    }
    
    const username = document.getElementById('editUsername').value;
    
    if (!confirm(`Are you sure you want to delete user "${username}"? This action cannot be undone.`)) return;
    
    const resp = await fetch(`/api/user/${userId}`, {
        method: 'DELETE'
    });
    
    const data = await resp.json();
    if (data.success) {
        showFlash('User deleted successfully', 'success');
        closeEditUserModal();
        await loadUsers();
    } else {
        showFlash(data.message, 'error');
    }
}

function showFlash(message, type = 'success') {
    const flash = document.createElement('div');
    flash.className = `flash ${type}`;
    flash.textContent = message;
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 3000);
}
if (!document.querySelector('#pulse-animation')) {
    const style = document.createElement('style');
    style.id = 'pulse-animation';
    style.textContent = `
        @keyframes pulse {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            100% { opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}
