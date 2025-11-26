"""
Hierarchical Task Management System for FPS Game Development
Flask + SQLAlchemy + SQLite with D3.js visualization
"""

from flask import Flask, render_template, request, redirect, url_for, jsonify, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from sqlalchemy import or_
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dev-secret-key-change-in-production'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///game_tasks.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# ==================== MODELS ====================

# Association table for many-to-many parent-child relationships
task_parents = db.Table('task_parents',
    db.Column('parent_id', db.Integer, db.ForeignKey('task.id'), primary_key=True),
    db.Column('child_id', db.Integer, db.ForeignKey('task.id'), primary_key=True)
)

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(20), default='developer')
    created_tasks = db.relationship('Task', foreign_keys='Task.creator_id', backref='creator')
    assigned_tasks = db.relationship('Task', foreign_keys='Task.assignee_id', backref='assignee')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    creator_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    assignee_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    status = db.Column(db.String(20), default='not_started')
    override_warning = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    parents = db.relationship('Task',
        secondary=task_parents,
        primaryjoin=(task_parents.c.child_id == id),
        secondaryjoin=(task_parents.c.parent_id == id),
        backref=db.backref('children', lazy='dynamic'),
        lazy='dynamic'
    )
    
    documentation = db.relationship('Documentation', backref='task', uselist=False, cascade='all, delete-orphan')
    status_history = db.relationship('StatusHistory', backref='task', cascade='all, delete-orphan')

    def get_depth(self):
        if not self.parents.count():
            return 0
        max_depth = 0
        for parent in self.parents:
            max_depth = max(max_depth, parent.get_depth() + 1)
        return max_depth

    def get_importance_weight(self):
        depth = self.get_depth()
        children_count = self.children.count()
        return depth * 10 + children_count * 2

    def get_progress(self):
        children = self.children.all()
        if not children:
            return 100 if self.status == 'integrated' else 0
        total = len(children)
        completed = sum(1 for child in children if child.status == 'integrated')
        return int((completed / total) * 100) if total > 0 else 0

    def can_edit(self, user):
        return user.role == 'admin' or user.id == self.creator_id or user.id == self.assignee_id

    def has_circular_relationship(self, potential_parent_id):
        if potential_parent_id == self.id:
            return True
        visited = set()
        to_visit = [potential_parent_id]
        while to_visit:
            current_id = to_visit.pop()
            if current_id == self.id:
                return True
            if current_id in visited:
                continue
            visited.add(current_id)
            task = Task.query.get(current_id)
            if task:
                parent_ids = [p.id for p in task.parents]
                to_visit.extend(parent_ids)
        return False

    def has_unfinished_children(self):
        children = self.children.all()
        status_order = ['not_started', 'started', 'functional', 'documented', 'integrated']
        functional_index = status_order.index('functional')
        for child in children:
            if status_order.index(child.status) < functional_index:
                return True
        return False

    def get_next_status_highlight(self, current_user_id=None):
        if self.assignee_id and self.assignee_id != current_user_id:
            return None
        children = self.children.all()
        if children:
            if not self.has_unfinished_children():
                status_progression = {
                    'not_started': 'started',
                    'started': 'functional',
                    'functional': 'documented',
                    'documented': 'integrated'
                }
                return status_progression.get(self.status)
        else:
            if not self.override_warning:
                status_progression = {
                    'not_started': 'started',
                    'started': 'functional',
                    'functional': 'documented',
                    'documented': 'integrated'
                }
                return status_progression.get(self.status)
        return None

class Documentation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id'), nullable=False)
    content = db.Column(db.Text)
    template_hint = db.Column(db.Text, default="List any externally accessible features here.\n\n\nVariables:\n\nFunctions:\n\nExample use cases:\n")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class StatusHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('task.id'), nullable=False)
    old_status = db.Column(db.String(20))
    new_status = db.Column(db.String(20), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship('User')

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# ==================== ROUTES ====================

@app.route('/')
@login_required
def index():
    return render_template('index.html', current_user=current_user)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('index'))
        flash('Invalid username or password', 'error')
    return render_template('login.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))

@app.route('/change_password', methods=['POST'])
@login_required
def change_password():
    old_password = request.form.get('old_password')
    new_password = request.form.get('new_password')
    if not current_user.check_password(old_password):
        return jsonify({'success': False, 'message': 'Incorrect current password'})
    current_user.set_password(new_password)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Password changed successfully'})

@app.route('/admin/add_user', methods=['POST'])
@login_required
def add_user():
    if current_user.role != 'admin':
        return jsonify({'success': False, 'message': 'Admin access required'})
    username = request.form.get('username')
    password = request.form.get('password')
    role = request.form.get('role', 'developer')
    if User.query.filter_by(username=username).first():
        return jsonify({'success': False, 'message': 'Username already exists'})
    user = User(username=username, role=role)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return jsonify({'success': True, 'message': 'User created successfully'})

@app.route('/api/users')
@login_required
def get_users():
    if current_user.role != 'admin':
        return jsonify([])
    users = User.query.all()
    return jsonify([{
        'id': u.id,
        'username': u.username,
        'role': u.role,
        'created_tasks_count': len(u.created_tasks),
        'assigned_tasks_count': len(u.assigned_tasks)
    } for u in users])

@app.route('/api/user/<int:user_id>', methods=['PUT'])
@login_required
def update_user(user_id):
    if current_user.role != 'admin':
        return jsonify({'success': False, 'message': 'Admin access required'}), 403
    user = User.query.get_or_404(user_id)
    data = request.json
    if 'username' in data:
        new_username = data['username'].strip()
        if new_username != user.username:
            existing_user = User.query.filter_by(username=new_username).first()
            if existing_user and existing_user.id != user.id:
                return jsonify({'success': False, 'message': 'Username already exists'})
            user.username = new_username
    if 'role' in data and data['role'] in ['admin', 'developer']:
        user.role = data['role']
    db.session.commit()
    return jsonify({'success': True, 'message': 'User updated successfully'})

@app.route('/api/user/<int:user_id>', methods=['DELETE'])
@login_required
def delete_user(user_id):
    if current_user.role != 'admin':
        return jsonify({'success': False, 'message': 'Admin access required'}), 403
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        return jsonify({'success': False, 'message': 'Cannot delete your own account'})
    db.session.delete(user)
    db.session.commit()
    return jsonify({'success': True, 'message': 'User deleted successfully'})

@app.route('/api/task/<int:task_id>/unassign', methods=['POST'])
@login_required
def unassign_task(task_id):
    task = Task.query.get_or_404(task_id)
    if current_user.role != 'admin' and task.creator_id != current_user.id and task.assignee_id != current_user.id:
        return jsonify({'success': False, 'message': 'Permission denied'}), 403
    task.assignee_id = None
    db.session.commit()
    return jsonify({'success': True, 'message': 'Task unassigned successfully'})

@app.route('/api/tasks')
@login_required
def get_tasks():
    tasks = Task.query.all()
    result = []
    for t in tasks:
        parent_ids = [p.id for p in t.parents]
        child_ids = [c.id for c in t.children.all()]
        result.append({
            'id': t.id,
            'title': t.title,
            'description': t.description,
            'parent_ids': parent_ids,
            'child_ids': child_ids,
            'status': t.status,
            'assignee': t.assignee.username if t.assignee else None,
            'assignee_id': t.assignee_id,
            'creator': t.creator.username,
            'progress': t.get_progress(),
            'created_at': t.created_at.isoformat(),
            'can_edit': t.can_edit(current_user),
            'next_status_highlight': t.get_next_status_highlight(current_user.id),
            'override_warning': t.override_warning
        })
    return jsonify(result)

@app.route('/api/task/<int:task_id>')
@login_required
def get_task(task_id):
    task = Task.query.get_or_404(task_id)
    parent_ids = [p.id for p in task.parents]
    child_ids = [c.id for c in task.children.all()]
    return jsonify({
        'id': task.id,
        'title': task.title,
        'description': task.description,
        'parent_ids': parent_ids,
        'child_ids': child_ids,
        'status': task.status,
        'assignee_id': task.assignee_id,
        'assignee': task.assignee.username if task.assignee else None,
        'creator': task.creator.username,
        'progress': task.get_progress(),
        'can_edit': task.can_edit(current_user),
        'documentation': task.documentation.content if task.documentation else '',
        'override_warning': task.override_warning,
        'history': [{
            'old_status': h.old_status,
            'new_status': h.new_status,
            'user': h.user.username,
            'timestamp': h.timestamp.isoformat()
        } for h in task.status_history]
    })

@app.route('/api/task', methods=['POST'])
@login_required
def create_task():
    data = request.json
    parent_ids = data.get('parent_ids', [])
    task = Task(
        title=data['title'],
        description=data.get('description', ''),
        creator_id=current_user.id,
        status='not_started'
    )
    db.session.add(task)
    db.session.flush()
    for parent_id in parent_ids:
        parent = Task.query.get(parent_id)
        if parent:
            if task.has_circular_relationship(parent_id):
                return jsonify({'success': False, 'message': 'Circular relationship detected'})
            task.parents.append(parent)
    doc = Documentation(
        task_id=task.id,
        content='',
        template_hint="List any externally accessible features here.\n\n\nVariables:\n\nFunctions:\n\nExample use cases:\n"
    )
    db.session.add(doc)
    db.session.commit()
    return jsonify({'success': True, 'task_id': task.id})

@app.route('/api/task/<int:task_id>', methods=['PUT'])
@login_required
def update_task(task_id):
    task = Task.query.get_or_404(task_id)
    if not task.can_edit(current_user):
        return jsonify({'success': False, 'message': 'Permission denied'}), 403
    data = request.json
    if 'title' in data:
        task.title = data['title']
    if 'description' in data:
        task.description = data['description']
    if 'parent_ids' in data:
        new_parent_ids = data['parent_ids']
        for parent_id in new_parent_ids:
            if task.has_circular_relationship(parent_id):
                return jsonify({'success': False, 'message': 'Circular relationship detected'})
        current_parents = set(p.id for p in task.parents)
        new_parents = set(new_parent_ids)
        for parent_id in current_parents - new_parents:
            parent = Task.query.get(parent_id)
            if parent:
                task.parents.remove(parent)
        for parent_id in new_parents - current_parents:
            parent = Task.query.get(parent_id)
            if parent:
                task.parents.append(parent)
    if 'status' in data:
        new_status = data['status']
        override = data.get('override_warning', False)
        if new_status != task.status:
            if task.has_unfinished_children() and not override:
                children = task.children.all()
                non_functional = [child for child in children if child.status not in ['functional', 'documented', 'integrated']]
                child_titles = [child.title for child in non_functional[:3]]
                message = f'This task has unfinished children: {", ".join(child_titles)}'
                if len(non_functional) > 3:
                    message += f' and {len(non_functional) - 3} more'
                message += '. Are you sure you want to proceed?'
                return jsonify({'success': False, 'warning': True, 'message': message})
            children = task.children.all()
            if children and new_status == 'integrated':
                non_integrated = [child for child in children if child.status != 'integrated']
                if non_integrated:
                    child_titles = [child.title for child in non_integrated[:3]]
                    message = f'Cannot integrate while children are not integrated: {", ".join(child_titles)}'
                    if len(non_integrated) > 3:
                        message += f' and {len(non_integrated) - 3} more'
                    return jsonify({'success': False, 'message': message})
            if override:
                task.override_warning = True
            history = StatusHistory(
                task_id=task.id,
                old_status=task.status,
                new_status=new_status,
                user_id=current_user.id
            )
            db.session.add(history)
            task.status = new_status
    if 'documentation' in data:
        if not task.documentation:
            task.documentation = Documentation(task_id=task.id)
        task.documentation.content = data['documentation']
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/task/<int:task_id>', methods=['DELETE'])
@login_required
def delete_task(task_id):
    task = Task.query.get_or_404(task_id)
    if current_user.role != 'admin' and task.creator_id != current_user.id:
        return jsonify({'success': False, 'message': 'Permission denied'}), 403
    if task.children.count() > 0:
        return jsonify({'success': False, 'message': 'Cannot delete task with children'})
    db.session.delete(task)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/task/<int:task_id>/request', methods=['POST'])
@login_required
def request_task(task_id):
    task = Task.query.get_or_404(task_id)
    if task.assignee_id:
        return jsonify({'success': False, 'message': 'Task already assigned'})
    if task.status != 'not_started':
        return jsonify({'success': False, 'message': 'Can only request not started tasks'})
    task.assignee_id = current_user.id
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/task/<int:task_id>/assign', methods=['POST'])
@login_required
def assign_task(task_id):
    if current_user.role != 'admin':
        return jsonify({'success': False, 'message': 'Admin access required'}), 403
    task = Task.query.get_or_404(task_id)
    user_id = request.json.get('user_id')
    if user_id:
        user = User.query.get(user_id)
        if not user:
            return jsonify({'success': False, 'message': 'User not found'})
        task.assignee_id = user_id
    else:
        task.assignee_id = None
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/task/<int:task_id>/children', methods=['POST'])
@login_required
def add_child(task_id):
    task = Task.query.get_or_404(task_id)
    child_id = request.json.get('child_id')
    if not child_id:
        return jsonify({'success': False, 'message': 'Child ID required'})
    if child_id == task.id:
        return jsonify({'success': False, 'message': 'Task cannot be its own child'})
    child = Task.query.get(child_id)
    if not child:
        return jsonify({'success': False, 'message': 'Child task not found'})
    if child in task.children:
        return jsonify({'success': False, 'message': 'Task is already a child'})
    child.parents.append(task)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/task/<int:task_id>/parents', methods=['POST'])
@login_required
def add_parent(task_id):
    task = Task.query.get_or_404(task_id)
    parent_id = request.json.get('parent_id')
    if not parent_id:
        return jsonify({'success': False, 'message': 'Parent ID required'})
    if parent_id == task.id:
        return jsonify({'success': False, 'message': 'Task cannot be its own parent'})
    parent = Task.query.get(parent_id)
    if not parent:
        return jsonify({'success': False, 'message': 'Parent task not found'})
    task.parents.append(parent)
    db.session.commit()
    return jsonify({'success': True})

@app.route('/api/task/<int:task_id>/parents/<int:parent_id>', methods=['DELETE'])
@login_required
def remove_parent(task_id, parent_id):
    task = Task.query.get_or_404(task_id)
    parent = Task.query.get(parent_id)
    if not parent:
        return jsonify({'success': False, 'message': 'Parent task not found'})
    if parent in task.parents:
        task.parents.remove(parent)
        db.session.commit()
    return jsonify({'success': True})

@app.route('/api/search')
@login_required
def search():
    query = request.args.get('q', '')
    if not query:
        return jsonify([])
    tasks = Task.query.filter(
        or_(
            Task.title.ilike(f'%{query}%'),
            Task.description.ilike(f'%{query}%')
        )
    ).all()
    results = []
    for task in tasks:
        doc_preview = ''
        if task.documentation and task.documentation.content:
            doc_preview = task.documentation.content[:200]
        results.append({
            'id': task.id,
            'title': task.title,
            'description': task.description[:100] if task.description else '',
            'doc_preview': doc_preview,
            'status': task.status
        })
    return jsonify(results)

@app.route('/dashboard')
@login_required
def dashboard():
    my_tasks = Task.query.filter_by(assignee_id=current_user.id).all()
    recent = Task.query.order_by(Task.updated_at.desc()).limit(10).all()
    return render_template('dashboard.html', my_tasks=my_tasks, recent=recent)

@app.route('/setup_db')
def setup_db():
    db.create_all()
    if not User.query.filter_by(username='admin').first():
        admin = User(username='admin', role='admin')
        admin.set_password('admin123')
        db.session.add(admin)
        db.session.commit()
        return 'Database created and admin user added (username: admin, password: admin123)'
    return 'Database already initialized'

if __name__ == '__main__':
    app.run(debug=True)